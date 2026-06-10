import type { Confidence, Coordinate, LocalPoint } from "../types/twin";

export interface ContextBuilding {
  id: string;
  name: string;
  footprint: LocalPoint[];
  height_m?: number;
  floors_estimate?: number;
  confidence: Confidence;
}

export interface ContextRoad {
  id: string;
  name: string;
  centerline: LocalPoint[];
  width_m: number;
  confidence: Confidence;
}

export interface ContextData {
  provider: "overpass" | "procedural";
  buildings: ContextBuilding[];
  roads: ContextRoad[];
  notes: string[];
}

interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

const METERS_PER_DEGREE_LAT = 111_320;

export function lonLatToLocalMeters(center: Coordinate, coord: Coordinate): LocalPoint {
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
  return {
    x: (coord.lon - center.lon) * metersPerDegreeLon,
    z: (coord.lat - center.lat) * METERS_PER_DEGREE_LAT
  };
}

function parseHeight(tags: Record<string, string> | undefined): { height?: number; floors?: number } {
  if (!tags) return {};
  const explicitHeight = Number.parseFloat((tags.height ?? "").replace(/[^\d.]/g, ""));
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  const floors = Number.isFinite(levels) ? Math.max(1, Math.round(levels)) : undefined;
  const height = Number.isFinite(explicitHeight)
    ? explicitHeight
    : floors
      ? Math.max(4, floors * 3.2)
      : undefined;
  return { height, floors };
}

function bboxAround(center: Coordinate, radiusMeters: number): [number, number, number, number] {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180));
  return [center.lat - latDelta, center.lon - lonDelta, center.lat + latDelta, center.lon + lonDelta];
}

export async function fetchOverpassContext(center: Coordinate): Promise<ContextData> {
  const [south, west, north, east] = bboxAround(center, 95);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  const query = `
    [out:json][timeout:8];
    (
      way["building"](${south},${west},${north},${east});
      way["highway"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "address-twin-preview-mvp/0.1"
      },
      body: new URLSearchParams({ data: query })
    });
    if (!response.ok) {
      return {
        provider: "procedural",
        buildings: [],
        roads: [],
        notes: [`Overpass unavailable: HTTP ${response.status}. Procedural context will be used.`]
      };
    }

    const body = (await response.json()) as OverpassResponse;
    const elements = body.elements ?? [];
    const nodes = new Map<number, Coordinate>();
    for (const element of elements) {
      if (element.type === "node" && element.lat !== undefined && element.lon !== undefined) {
        nodes.set(element.id, { lat: element.lat, lon: element.lon });
      }
    }

    const buildings: ContextBuilding[] = [];
    const roads: ContextRoad[] = [];
    for (const element of elements) {
      if (element.type !== "way" || !element.nodes?.length) continue;
      const points = element.nodes
        .map((nodeId) => nodes.get(nodeId))
        .filter((node): node is Coordinate => Boolean(node))
        .map((coord) => lonLatToLocalMeters(center, coord));

      if (points.length < 2) continue;
      if (element.tags?.building && points.length >= 4) {
        const parsed = parseHeight(element.tags);
        buildings.push({
          id: `osm-building-${element.id}`,
          name: element.tags.name ?? "OSM building",
          footprint: points,
          height_m: parsed.height,
          floors_estimate: parsed.floors,
          confidence: parsed.height ? "medium" : "low"
        });
      }

      if (element.tags?.highway) {
        const roadWidth = Number.parseFloat(element.tags.width ?? "");
        roads.push({
          id: `osm-road-${element.id}`,
          name: element.tags.name ?? "nearby road",
          centerline: points,
          width_m: Number.isFinite(roadWidth) ? roadWidth : 5.5,
          confidence: "medium"
        });
      }
    }

    return {
      provider: "overpass",
      buildings: buildings.slice(0, 18),
      roads: roads.slice(0, 8),
      notes: [
        "Overpass context is best-effort preview context.",
        "OSM features are not a substitute for official Korean parcel/building records."
      ]
    };
  } catch (error) {
    return {
      provider: "procedural",
      buildings: [],
      roads: [],
      notes: [
        `Overpass request failed: ${error instanceof Error ? error.message : "unknown error"}.`,
        "Procedural context will be used."
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface OvertureFutureConnector {
  status: "placeholder";
  note: string;
}

export function getOvertureFutureConnector(): OvertureFutureConnector {
  return {
    status: "placeholder",
    note:
      "Overture building footprints can be used later for overseas expansion. MVP does not download Overture data; building geometry is 2D footprint/roofprint and height/num_floors can approximate 3D when available."
  };
}
