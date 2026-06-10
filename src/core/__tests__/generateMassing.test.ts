import { describe, expect, it } from "vitest";
import type { GeocodeResult } from "../../types/twin";
import { generateMassing, type GenerateMassingOptions } from "../generateMassing";

function makeGeocoding(): GeocodeResult {
  return {
    selected: {
      provider: "fallback",
      request_time: "2026-06-11T00:00:00.000Z",
      address_query: "사당동 317-6",
      result_count: 1,
      selected_lon_lat: [126.96975, 37.4842],
      confidence: "low",
      restrictions_note: "approximate preview coordinate"
    },
    provider: "fallback",
    confidence: "low",
    candidates: [
      { label: "서울 동작구 사당동 317-6", type: "parcel" },
      { label: "서울 동작구 사당로20가길 39", type: "road" },
      { label: "행복이가득한집", type: "building_name" }
    ],
    notes: []
  };
}

function makeOptions(overrides: Partial<GenerateMassingOptions> = {}): GenerateMassingOptions {
  return {
    projectId: "test_project",
    rawQuery: "사당동 317-6 디지털 트윈",
    center: { lat: 37.4842, lon: 126.96975 },
    geocoding: makeGeocoding(),
    ...overrides
  };
}

describe("generateMassing", () => {
  it("creates a low-confidence procedural target when no official footprint exists", () => {
    const twin = generateMassing(makeOptions());
    const target = twin.buildings.find((building) => building.role === "target");
    expect(target).toBeDefined();
    expect(target?.source_type).toBe("procedural");
    expect(target?.confidence).toBe("low");
    expect(twin.spatial_reference?.anchor_source).toBe("geocoder_search_point");
  });

  it("uses the official footprint and height when provided", () => {
    const footprint = [
      { x: -5, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: 5 },
      { x: -5, z: 5 },
      { x: -5, z: -5 }
    ];
    const twin = generateMassing(makeOptions({ officialFootprint: footprint, officialHeightM: 32 }));
    const target = twin.buildings.find((building) => building.role === "target");
    expect(target?.source_type).toBe("official");
    expect(target?.confidence).toBe("high");
    expect(target?.height_m).toBe(32);
    expect(target?.footprint).toEqual(footprint);
    expect(twin.spatial_reference?.anchor_source).toBe("official_target_footprint_centroid");
  });

  it("derives address labels from the geocoding candidates", () => {
    const twin = generateMassing(makeOptions());
    expect(twin.addresses.parcel_address).toBe("서울 동작구 사당동 317-6");
    expect(twin.addresses.road_address_candidate).toBe("서울 동작구 사당로20가길 39");
    expect(twin.addresses.building_name_candidate).toBe("행복이가득한집");
  });

  it("falls back to procedural surroundings and caps context at 18 buildings", () => {
    const manyBuildings = Array.from({ length: 30 }, (_, index) => ({
      id: `osm-${index}`,
      name: `건물 ${index}`,
      footprint: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
        { x: 0, z: 0 }
      ],
      height_m: 12,
      floors_estimate: 4,
      confidence: "medium" as const
    }));

    const procedural = generateMassing(makeOptions());
    expect(procedural.buildings.filter((building) => building.role === "surrounding").length).toBeGreaterThan(0);
    expect(procedural.buildings.every((b) => b.role === "target" || b.source_type === "procedural")).toBe(true);

    const withContext = generateMassing(
      makeOptions({ context: { provider: "overpass", buildings: manyBuildings, roads: [], notes: [] } })
    );
    expect(withContext.buildings.filter((building) => building.role === "surrounding").length).toBe(18);
    expect(withContext.buildings.some((building) => building.source_type === "osm")).toBe(true);
  });

  it("provides procedural road hints when OSM roads are missing", () => {
    const twin = generateMassing(makeOptions());
    expect(twin.roads.length).toBeGreaterThan(0);
    expect(twin.roads.every((road) => road.source_type === "procedural")).toBe(true);
  });
});
