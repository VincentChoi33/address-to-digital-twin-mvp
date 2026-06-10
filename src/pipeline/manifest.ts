import type { SourceManifest, TwinProject } from "../types/twin";

export function buildSourceManifest(twin: TwinProject): SourceManifest {
  const target = twin.buildings.find((building) => building.role === "target");
  const hasOsm = twin.buildings.some((building) => building.source_type === "osm");

  return {
    project_id: twin.project_id,
    generated_at: new Date().toISOString(),
    input: twin.input,
    geocoding: {
      selected: twin.geocoding.selected,
      provider: twin.geocoding.provider,
      confidence: twin.geocoding.confidence,
      notes: twin.geocoding.notes
    },
    layers: [
      {
        name: "satellite_ground",
        source: "procedural",
        usage: "preview basemap",
        license_note:
          "Offline procedural grid is fallback. VWorld WMTS, ArcGIS, or custom tiles are optional live preview sources and must not be cached or redistributed without reviewing provider terms."
      },
      {
        name: "target_building_massing",
        source: target?.source_type === "official" ? "official footprint/attributes" : "procedural fallback",
        confidence: target?.confidence ?? "low"
      },
      {
        name: "surrounding_context_massing",
        source: hasOsm ? "OSM/Overpass best-effort only" : "procedural fallback",
        confidence: hasOsm ? "medium" : "low"
      },
      {
        name: "parcel_boundary",
        source: "procedural fallback",
        confidence: twin.parcel.confidence
      },
      {
        name: "road_hints",
        source: twin.roads.some((road) => road.source_type === "osm")
          ? "OSM/Overpass best-effort"
          : "procedural fallback",
        confidence: twin.roads.some((road) => road.confidence === "medium") ? "medium" : "low"
      }
    ],
    limitations: [
      "Not survey-grade",
      "Exact PNU/parcel boundary not verified",
      "Building footprint/height should be replaced with official GIS data",
      twin.geocoding.provider === "vworld"
        ? "VWorld/Juso may verify address coordinates, but parcel/building geometry is still preview-only"
        : "Preview coordinate may be approximate until VWorld/Juso verification succeeds",
      "Optional basemap tiles are for browser preview only and are not cached by this MVP"
    ],
    next_actions: [
      "Add Juso and VWorld keys",
      "Resolve PNU",
      "Fetch parcel boundary",
      "Fetch GIS building integrated info",
      "Generate official LOD1/LOD2 geometry",
      "Export glTF/3D Tiles"
    ]
  };
}
