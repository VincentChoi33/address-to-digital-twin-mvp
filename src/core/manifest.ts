import type { SourceManifest, TwinProject } from "../types/twin";

export function buildSourceManifest(twin: TwinProject): SourceManifest {
  const target = twin.buildings.find((building) => building.role === "target");
  const hasOfficialTarget = target?.source_type === "official";
  const hasOfficialContext = twin.buildings.some(
    (building) => building.role === "surrounding" && building.source_type === "official"
  );
  const hasOsm = twin.buildings.some((building) => building.source_type === "osm");
  const hasOfficialParcel = twin.parcel.source_type === "official";
  const hasOfficialRoads = twin.roads.some((road) => road.source_type === "official");
  const hasOsmRoads = twin.roads.some((road) => road.source_type === "osm");

  const layers: SourceManifest["layers"] = [
    {
      name: "satellite_ground",
      source: twin.geocoding.provider === "vworld" ? "live preview tiles / no cache" : "procedural",
      usage: "preview basemap",
      confidence: twin.geocoding.provider === "vworld" ? "medium" : "low",
      license_note:
        "Offline procedural grid is fallback. VWorld WMTS, ArcGIS, or custom tiles are optional live preview sources and must not be cached or redistributed without reviewing provider terms."
    }
  ];

  if (twin.spatial_reference) {
    layers.push({
      name: "spatial_reference",
      source: twin.spatial_reference.anchor_source,
      usage: "local origin and geometry alignment authority",
      confidence: hasOfficialParcel ? "high" : hasOfficialTarget ? "medium" : "low",
      license_note:
        "Cadastral/WFS geometry is the alignment authority when present; satellite imagery is a visual texture and not legal geometry."
    });
  }

  layers.push(
    {
      name: "target_building_massing",
      source: hasOfficialTarget ? "official footprint/attributes" : "procedural fallback",
      confidence: target?.confidence ?? "low"
    },
    {
      name: "surrounding_context_massing",
      source: hasOfficialContext
        ? "official footprint/attributes"
        : hasOsm
          ? "OSM/Overpass best-effort only"
          : "procedural fallback",
      confidence: hasOfficialContext ? "medium" : hasOsm ? "medium" : "low"
    },
    {
      name: "parcel_boundary",
      source: hasOfficialParcel ? "official cadastral/parcel boundary" : "procedural fallback",
      confidence: twin.parcel.confidence
    },
    {
      name: "road_hints",
      source: hasOfficialRoads ? "official road geometry" : hasOsmRoads ? "OSM/Overpass best-effort" : "procedural fallback",
      confidence: hasOfficialRoads
        ? "medium"
        : twin.roads.some((road) => road.confidence === "medium")
          ? "medium"
          : "low"
    }
  );

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
    layers,
    limitations: [
      "Not survey-grade",
      hasOfficialParcel ? "Exact PNU/parcel boundary is connected but not legally certified by this MVP" : "Exact PNU/parcel boundary not verified",
      hasOfficialTarget
        ? "Building footprint is connected; height/floor attributes still require official-record review before production use"
        : "Building footprint/height should be replaced with official GIS data",
      hasOfficialTarget || hasOfficialParcel
        ? "VWorld/Juso/WFS geometry is connected for preview alignment"
        : twin.geocoding.provider === "vworld"
          ? "VWorld/Juso may verify address coordinates, but parcel/building geometry is still preview-only"
          : "Preview coordinate may be approximate until VWorld/Juso verification succeeds",
      "Optional basemap tiles are for browser preview only and are not cached by this MVP",
      "Satellite imagery is a texture layer and is not the source of legal parcel or building geometry"
    ],
    next_actions: [
      twin.geocoding.provider === "vworld" ? "Persist and review selected PNU" : "Add Juso and VWorld keys",
      hasOfficialParcel ? "Cross-check WFS parcel boundary against selected address" : "Fetch parcel boundary",
      hasOfficialTarget ? "Compare WFS footprint/height against building integrated records" : "Fetch GIS building integrated info",
      "Generate official LOD1/LOD2 geometry",
      "Export glTF/3D Tiles"
    ]
  };
}
