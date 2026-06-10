import type {
  BuildingFeature,
  Coordinate,
  LocalPoint,
  ParcelBoundary,
  RoadHint,
  TwinProject
} from "../types/twin";
import type { ContextData } from "./dataConnectors";

export interface GenerateMassingOptions {
  projectId: string;
  rawQuery: string;
  center: Coordinate;
  geocoding: TwinProject["geocoding"];
  context?: ContextData;
  officialFootprint?: LocalPoint[];
  officialHeightM?: number;
}

function addressSummary(geocoding: TwinProject["geocoding"]) {
  const parcel =
    geocoding.normalized?.parcel_address ||
    geocoding.candidates.find((candidate) => candidate.type === "parcel")?.label ||
    geocoding.selected.address_query;
  const road =
    geocoding.normalized?.road_address ||
    geocoding.candidates.find((candidate) => candidate.type === "road")?.label ||
    geocoding.selected.address_query;
  const building =
    geocoding.normalized?.building_name ||
    geocoding.candidates.find((candidate) => candidate.type === "building_name")?.label ||
    "대상 건물 후보";
  return { parcel, road, building };
}

function rectangle(width: number, depth: number, x = 0, z = 0, rotationRad = 0): LocalPoint[] {
  const halfW = width / 2;
  const halfD = depth / 2;
  const points = [
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD },
    { x: -halfW, z: -halfD }
  ];
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return points.map((point) => ({
    x: x + point.x * cos - point.z * sin,
    z: z + point.x * sin + point.z * cos
  }));
}

function makeProceduralBuildings(): BuildingFeature[] {
  const configs = [
    [-32, -8, 15, 20, 17, 0.08],
    [-30, 22, 20, 13, 12, -0.12],
    [28, -18, 14, 17, 24, 0.15],
    [36, 18, 22, 16, 18, -0.05],
    [-8, 38, 12, 18, 15, 0.18],
    [12, -40, 20, 12, 9, -0.2],
    [54, -5, 15, 21, 27, 0.03],
    [-55, 8, 18, 14, 11, 0.1],
    [-48, -34, 22, 16, 21, -0.08],
    [48, 42, 16, 14, 13, 0.2],
    [4, 58, 28, 12, 16, 0],
    [-2, -62, 24, 15, 19, 0.05]
  ];

  return configs.map(([x, z, width, depth, height, rotation], index) => ({
    id: `procedural-context-${index + 1}`,
    name: `주변 매스 ${index + 1}`,
    role: "surrounding",
    footprint: rectangle(width, depth, x, z, rotation),
    height_m: height,
    floors_estimate: Math.max(2, Math.round(height / 3.4)),
    source_type: "procedural",
    confidence: "low",
    material_hint: "neutral_gray"
  }));
}

function makeRoadHints(context?: ContextData): RoadHint[] {
  const osmRoads =
    context?.roads.map<RoadHint>((road) => ({
      id: road.id,
      name: road.name,
      centerline: road.centerline,
      width_m: road.width_m,
      source_type: "osm",
      confidence: road.confidence
    })) ?? [];

  if (osmRoads.length > 0) return osmRoads;

  return [
    {
      id: "procedural-road-main",
      name: "사당로20가길 방향 추정",
      centerline: [
        { x: -74, z: -23 },
        { x: 74, z: -5 }
      ],
      width_m: 6,
      source_type: "procedural",
      confidence: "low"
    },
    {
      id: "procedural-road-alley",
      name: "골목 연결 추정",
      centerline: [
        { x: 20, z: -72 },
        { x: 9, z: 70 }
      ],
      width_m: 4.2,
      source_type: "procedural",
      confidence: "low"
    }
  ];
}

function makeParcelBoundary(): ParcelBoundary {
  return {
    id: "approx-parcel-boundary",
    name: "필지 경계 추정",
    boundary: [
      { x: -12.5, z: -10.3 },
      { x: 12.7, z: -8.4 },
      { x: 11.2, z: 10.6 },
      { x: -13.6, z: 8.9 },
      { x: -12.5, z: -10.3 }
    ],
    source_type: "procedural",
    confidence: "low"
  };
}

export function generateMassing(options: GenerateMassingOptions): TwinProject {
  const addresses = addressSummary(options.geocoding);
  const contextBuildings =
    options.context?.buildings.map<BuildingFeature>((building, index) => ({
      id: building.id,
      name: building.name || `OSM 주변 건물 ${index + 1}`,
      role: "surrounding",
      footprint: building.footprint,
      height_m: building.height_m ?? 10 + (index % 4) * 3,
      floors_estimate: building.floors_estimate ?? Math.max(2, Math.round((building.height_m ?? 12) / 3.2)),
      source_type: "osm",
      confidence: building.confidence,
      material_hint: "neutral_gray"
    })) ?? [];

  const surrounding = (contextBuildings.length > 0 ? contextBuildings : makeProceduralBuildings()).slice(0, 18);
  const hasOfficialTarget = Boolean(options.officialFootprint?.length);
  const target: BuildingFeature = {
    id: "target-building",
    name: addresses.building,
    role: "target",
    footprint: hasOfficialTarget ? options.officialFootprint! : rectangle(18, 13, 0, 0, -0.06),
    height_m: options.officialHeightM ?? 21,
    floors_estimate: options.officialHeightM ? Math.round(options.officialHeightM / 3.2) : 5,
    source_type: hasOfficialTarget ? "official" : "procedural",
    confidence: hasOfficialTarget ? "high" : "low",
    material_hint: "teal_target"
  };

  return {
    project_id: options.projectId,
    created_at: new Date().toISOString(),
    input: {
      raw_query: options.rawQuery,
      normalized_address_candidates: options.geocoding.candidates
    },
    center: options.center,
    spatial_reference: {
      crs: "EPSG:4326",
      local_frame: "local_meter_tangent_plane",
      projection: "WebMercator-derived local meters with latitude scale correction",
      anchor_source: hasOfficialTarget ? "official_target_footprint_centroid" : "geocoder_search_point",
      anchor_lon_lat: [options.center.lon, options.center.lat],
      search_lon_lat: [options.center.lon, options.center.lat],
      texture_alignment:
        "Static sample uses the available target/geocoder anchor. In deployed WFS mode, official parcel centroid is preferred and satellite imagery is draped as a preview texture."
    },
    addresses: {
      parcel_address: addresses.parcel,
      road_address_candidate: addresses.road,
      building_name_candidate: addresses.building
    },
    geocoding: options.geocoding,
    buildings: [target, ...surrounding],
    roads: makeRoadHints(options.context),
    pois: [],
    parcel: makeParcelBoundary(),
    basemap: {
      default_source: "procedural",
      attribution:
        "Default ground is procedural/offline. Optional VWorld WMTS, ArcGIS World Imagery, or custom tiles require visible attribution and no local caching.",
      offline_fallback: "procedural_grid"
    },
    viewer: {
      initial_camera: {
        position: [58, 58, 74],
        target: [0, 7, 0]
      },
      warning: "프리뷰 전용입니다. 현재 좌표·필지·건물 형상은 근사치이며 공식 데이터 연결이 필요합니다."
    }
  };
}
