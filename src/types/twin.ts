export type Confidence = "high" | "medium" | "low";

export type GeometrySourceType = "official" | "osm" | "procedural" | "user_adjusted";

export type BasemapSource = "procedural" | "VWorld WMTS" | "ArcGIS World Imagery" | "custom";

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export interface SpatialReference {
  crs: "EPSG:4326";
  local_frame: "local_meter_tangent_plane";
  projection: string;
  anchor_source:
    | "official_parcel_centroid"
    | "official_target_footprint_centroid"
    | "target_preview_centroid"
    | "geocoder_search_point";
  anchor_lon_lat: [number, number];
  search_lon_lat: [number, number];
  texture_alignment: string;
}

export interface AddressCandidate {
  label: string;
  type: "parcel" | "road" | "building_name" | "poi" | "raw";
}

export interface GeocodeSelected {
  provider: "vworld" | "nominatim" | "fallback";
  request_time: string;
  address_query: string;
  result_count: number;
  selected_lon_lat: [number, number];
  confidence: Confidence;
  restrictions_note: string;
  note?: string;
  place_title?: string;
  place_id?: string;
  road_address?: string;
  parcel_address?: string;
}

export interface GeocodeResult {
  selected: GeocodeSelected;
  provider: GeocodeSelected["provider"];
  confidence: Confidence;
  candidates: AddressCandidate[];
  notes: string[];
  normalized?: {
    provider: "juso";
    request_time: string;
    result_count: number;
    road_address?: string;
    parcel_address?: string;
    building_name?: string;
    adm_cd?: string;
    rn_mgt_sn?: string;
    confidence: Confidence;
    restrictions_note: string;
  };
}

export interface BuildingFeature {
  id: string;
  name: string;
  role: "target" | "surrounding";
  footprint: LocalPoint[];
  height_m: number;
  floors_estimate?: number;
  source_type: GeometrySourceType;
  confidence: Confidence;
  material_hint?: string;
}

export interface RoadHint {
  id: string;
  name: string;
  centerline: LocalPoint[];
  width_m: number;
  source_type: GeometrySourceType;
  confidence: Confidence;
}

export interface PoiMarker {
  id: string;
  label: string;
  point: LocalPoint;
  kind: "entrance" | "sensor" | "checkpoint";
  source_type: GeometrySourceType;
  confidence: Confidence;
}

export interface ParcelBoundary {
  id: string;
  name: string;
  boundary: LocalPoint[];
  source_type: GeometrySourceType;
  confidence: Confidence;
}

export interface TwinProject {
  project_id: string;
  created_at: string;
  input: {
    raw_query: string;
    normalized_address_candidates: AddressCandidate[];
  };
  center: Coordinate;
  spatial_reference?: SpatialReference;
  addresses: {
    parcel_address: string;
    road_address_candidate: string;
    building_name_candidate: string;
  };
  geocoding: GeocodeResult;
  buildings: BuildingFeature[];
  roads: RoadHint[];
  pois: PoiMarker[];
  parcel: ParcelBoundary;
  basemap: {
    default_source: BasemapSource;
    attribution: string;
    tile_template?: string;
    offline_fallback: "procedural_grid";
  };
  viewer: {
    initial_camera: {
      position: [number, number, number];
      target: [number, number, number];
    };
    warning: string;
  };
}

export interface LayerManifest {
  name: string;
  source: string;
  usage?: string;
  confidence?: Confidence;
  license_note?: string;
}

export interface SourceManifest {
  project_id: string;
  generated_at: string;
  input: TwinProject["input"];
  geocoding: {
    selected: GeocodeSelected;
    provider: GeocodeSelected["provider"];
    confidence: Confidence;
    notes: string[];
  };
  layers: LayerManifest[];
  limitations: string[];
  next_actions: string[];
}

export interface HydrologyCell {
  x: number;
  z: number;
  type: "grass" | "road" | "building";
  elevation: number;
  buildingHeight: number;
  isTarget: boolean;
  isLandmark: boolean;
  name: string;

  // Infra
  hasSewer: boolean;
  hasPipe: boolean;
  hasOutfall: boolean;
  isSubwayExit: number | null;

  // Water
  water: number;
  pipeWater: number;

  // Three.js groups/meshes (typed as any to prevent strict type import pollution)
  group?: any;
  buildingMesh?: any;
  sewerMesh?: any;
  pipeMesh?: any;
  outfallMesh?: any;
  waterMesh?: any;
  subwayMesh?: any;
}

export interface HydrologyState {
  selectedTool: string;
  selectedCell: { x: number; z: number } | null;
  viewMode: "surface" | "contour" | "risk" | "xray";
  rainIntensity: number;
  grid: HydrologyCell[][];
  elapsedTime: number;
  scenario: "normal" | "2022" | "expand" | "tunnel";
  theme: "light" | "dark";

  // Stats
  totalSurfaceWater: number;
  totalPipeWater: number;
  subwayWater: number;
  totalOutflowVolume: number;
  overflowCount: number;

  // Subway warnings state
  subwayWarningTriggered: boolean;
}

