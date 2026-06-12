import { ShapeUtils, Vector2 } from "three";
import type { BuildingFeature, LocalPoint, RoadHint, SourceManifest, TwinProject } from "../types/twin";

export interface LocalRuntimeProbe {
  nvidiaSmi: "available" | "missing";
  docker: "available" | "missing";
  usdPython: "available" | "missing";
  usdChecker: "available" | "missing";
  note: string;
}

export interface OmniverseExportResult {
  usda: string;
  stackManifest: object;
  simreadyReport: object;
  readme: string;
  summary: {
    projectId: string;
    buildingMeshes: number;
    roadMeshes: number;
    parcelBoundary: boolean;
    metersPerUnit: 1;
    upAxis: "Y";
  };
}

interface MeshSpec {
  name: string;
  points: Array<[number, number, number]>;
  faceVertexCounts: number[];
  faceVertexIndices: number[];
  materialPath: string;
  physicsCollision?: boolean;
  customData?: Record<string, string | number | boolean>;
}

const DOMAIN_SIZE_M = 440;
const HALF_DOMAIN_M = DOMAIN_SIZE_M / 2;

const MATERIALS = {
  terrain: "Terrain_DrapedPreviewImagery",
  target: "Official_Target_Building_Teal",
  context: "Official_Context_Building_Concrete",
  road: "Official_Road_Asphalt",
  parcel: "Official_Parcel_Boundary_Gold",
  water: "GPU_Flood_Water_Hazard"
} as const;

export function exportTwinToOmniversePackage(
  twin: TwinProject,
  manifest: SourceManifest,
  runtimeProbe: LocalRuntimeProbe = defaultRuntimeProbe()
): OmniverseExportResult {
  const rootName = sanitizeIdentifier(twin.project_id || "address_twin");
  const rootPath = `/${rootName}`;
  const materialPath = (name: string) => `${rootPath}/Looks/${name}`;
  const meshes: MeshSpec[] = [];
  const generatedAt = manifest.generated_at || twin.created_at || new Date().toISOString();

  meshes.push(makeTerrainBoardMesh("Terrain_DrapedPreviewSurface", materialPath(MATERIALS.terrain)));

  for (const building of twin.buildings) {
    const mesh = makeBuildingMesh(building, materialPath(building.role === "target" ? MATERIALS.target : MATERIALS.context));
    if (mesh) meshes.push(mesh);
  }

  twin.roads.forEach((road, index) => {
    const mesh = makeRoadMesh(road, index + 1, materialPath(MATERIALS.road));
    if (mesh) meshes.push(mesh);
  });

  const parcelMesh = makeParcelBoundaryMesh(twin.parcel.boundary, materialPath(MATERIALS.parcel));
  if (parcelMesh) meshes.push(parcelMesh);

  meshes.push(makeFloodWaterReferenceMesh("FloodScenario_Cloudburst_WaterReference", materialPath(MATERIALS.water)));

  const usda = renderUsda({ rootName, rootPath, twin, manifest, meshes });
  const stackManifest = buildStackManifest(twin, manifest, runtimeProbe, meshes, generatedAt);
  const simreadyReport = buildSimReadyMinimumReport(twin, manifest, runtimeProbe, meshes, generatedAt);
  const readme = buildPackageReadme(twin, runtimeProbe);

  return {
    usda,
    stackManifest,
    simreadyReport,
    readme,
    summary: {
      projectId: twin.project_id,
      buildingMeshes: twin.buildings.length,
      roadMeshes: twin.roads.length,
      parcelBoundary: twin.parcel.boundary.length >= 3,
      metersPerUnit: 1,
      upAxis: "Y"
    }
  };
}

function defaultRuntimeProbe(): LocalRuntimeProbe {
  return {
    nvidiaSmi: "missing",
    docker: "missing",
    usdPython: "missing",
    usdChecker: "missing",
    note: "No runtime probe was supplied; package authoring is deterministic and runtime validation must run on an NVIDIA Omniverse workstation or container."
  };
}

function renderUsda({
  rootName,
  rootPath,
  twin,
  manifest,
  meshes
}: {
  rootName: string;
  rootPath: string;
  twin: TwinProject;
  manifest: SourceManifest;
  meshes: MeshSpec[];
}): string {
  const lines: string[] = [];
  lines.push("#usda 1.0");
  lines.push("(");
  lines.push(`    defaultPrim = "${rootName}"`);
  lines.push("    metersPerUnit = 1");
  lines.push("    upAxis = \"Y\"");
  lines.push(")");
  lines.push("");
  lines.push(`def Xform "${rootName}" (`);
  lines.push("    kind = \"component\"");
  lines.push("    assetInfo = {");
  lines.push(`        string name = ${q(twin.addresses.parcel_address)}`);
  lines.push(`        string identifier = ${q(twin.project_id)}`);
  lines.push("    }");
  lines.push("    customData = {");
  lines.push("        string nvidiaWorkflow = \"OpenUSD -> Omniverse RTX/ovrtx -> SimReady validation candidate\"");
  lines.push(`        string geocodeProvider = ${q(twin.geocoding.provider)}`);
  lines.push(`        string sourceManifestProject = ${q(manifest.project_id)}`);
  lines.push(`        string address = ${q(twin.addresses.parcel_address)}`);
  lines.push(`        string roadAddress = ${q(twin.addresses.road_address_candidate)}`);
  if (twin.spatial_reference) {
    lines.push(`        string anchorSource = ${q(twin.spatial_reference.anchor_source)}`);
    lines.push(`        double anchorLongitude = ${fmt(twin.spatial_reference.anchor_lon_lat[0])}`);
    lines.push(`        double anchorLatitude = ${fmt(twin.spatial_reference.anchor_lon_lat[1])}`);
  }
  lines.push("    }");
  lines.push(")");
  lines.push("{");
  lines.push(renderLooks(rootPath));
  lines.push(renderMetadataScope(rootPath, twin, manifest));
  lines.push(renderPhysicsScene());
  lines.push("    def Xform \"Geometry\"");
  lines.push("    {");
  for (const mesh of meshes) lines.push(renderMesh(mesh, 2));
  lines.push("    }");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderLooks(rootPath: string): string {
  const specs: Array<{ name: string; color: [number, number, number]; roughness: number; opacity?: number; metallic?: number }> = [
    { name: MATERIALS.terrain, color: [0.24, 0.32, 0.28], roughness: 0.96 },
    { name: MATERIALS.target, color: [0.08, 0.72, 0.65], roughness: 0.35, metallic: 0.1 },
    { name: MATERIALS.context, color: [0.72, 0.76, 0.8], roughness: 0.62 },
    { name: MATERIALS.road, color: [0.08, 0.1, 0.13], roughness: 0.9 },
    { name: MATERIALS.parcel, color: [1.0, 0.72, 0.16], roughness: 0.5 },
    { name: MATERIALS.water, color: [0.05, 0.56, 0.74], roughness: 0.08, opacity: 0.58, metallic: 0.0 }
  ];
  const lines: string[] = [];
  lines.push("    def Scope \"Looks\"");
  lines.push("    {");
  for (const spec of specs) {
    lines.push(`        def Material "${spec.name}"`);
    lines.push("        {");
    lines.push(`            token outputs:surface.connect = <${rootPath}/Looks/${spec.name}/PreviewSurface.outputs:surface>`);
    lines.push("            def Shader \"PreviewSurface\"");
    lines.push("            {");
    lines.push("                uniform token info:id = \"UsdPreviewSurface\"");
    lines.push(`                color3f inputs:diffuseColor = (${spec.color.map(fmt).join(", ")})`);
    lines.push(`                float inputs:roughness = ${fmt(spec.roughness)}`);
    lines.push(`                float inputs:metallic = ${fmt(spec.metallic ?? 0)}`);
    if (spec.opacity !== undefined) lines.push(`                float inputs:opacity = ${fmt(spec.opacity)}`);
    lines.push("                token outputs:surface");
    lines.push("            }");
    lines.push("        }");
  }
  lines.push("    }");
  return lines.join("\n");
}

function renderMetadataScope(rootPath: string, twin: TwinProject, manifest: SourceManifest): string {
  const officialBuildings = twin.buildings.filter((building) => building.source_type === "official").length;
  const officialRoads = twin.roads.filter((road) => road.source_type === "official").length;
  const lines: string[] = [];
  lines.push("    def Scope \"NVIDIA_Pipeline_Metadata\" (");
  lines.push("        customData = {");
  lines.push("            string openUsdRole = \"canonical interchange layer for NVIDIA Omniverse\"");
  lines.push("            string simReadyRole = \"candidate prop/site package; Content Agents and Asset Validator gates are external runtime steps\"");
  lines.push("            string viewerRole = \"open with Omniverse/ovrtx, not browser-side WebGL\"");
  lines.push(`            int officialBuildingCount = ${officialBuildings}`);
  lines.push(`            int officialRoadCount = ${officialRoads}`);
  lines.push(`            string sourceLayers = ${q(manifest.layers.map((layer) => `${layer.name}:${layer.confidence ?? "unknown"}`).join("; "))}`);
  lines.push("        }");
  lines.push("    )");
  lines.push("    {");
  lines.push("    }");
  return lines.join("\n").replaceAll("${rootPath}", rootPath);
}

function renderPhysicsScene(): string {
  return [
    "    def PhysicsScene \"PhysicsScene\"",
    "    {",
    "        vector3f physics:gravityDirection = (0, -1, 0)",
    "        float physics:gravityMagnitude = 9.81",
    "    }"
  ].join("\n");
}

function renderMesh(mesh: MeshSpec, indentLevel: number): string {
  const indent = "    ".repeat(indentLevel);
  const apiSchemas = ["MaterialBindingAPI"];
  if (mesh.physicsCollision) apiSchemas.push("PhysicsCollisionAPI");
  const lines: string[] = [];
  lines.push(`${indent}def Mesh "${mesh.name}" (`);
  lines.push(`${indent}    prepend apiSchemas = [${apiSchemas.map(q).join(", ")}]`);
  if (mesh.customData && Object.keys(mesh.customData).length > 0) {
    lines.push(`${indent}    customData = {`);
    for (const [key, value] of Object.entries(mesh.customData)) {
      const type = typeof value === "number" ? (Number.isInteger(value) ? "int" : "double") : typeof value === "boolean" ? "bool" : "string";
      lines.push(`${indent}        ${type} ${sanitizeIdentifier(key)} = ${usdValue(value)}`);
    }
    lines.push(`${indent}    }`);
  }
  lines.push(`${indent})`);
  lines.push(`${indent}{`);
  lines.push(`${indent}    rel material:binding = <${mesh.materialPath}>`);
  if (mesh.physicsCollision) {
    lines.push(`${indent}    bool physics:collisionEnabled = true`);
  }
  lines.push(`${indent}    point3f[] points = ${renderVec3Array(mesh.points, indent + "    ")}`);
  lines.push(`${indent}    int[] faceVertexCounts = ${renderNumberArray(mesh.faceVertexCounts)}`);
  lines.push(`${indent}    int[] faceVertexIndices = ${renderNumberArray(mesh.faceVertexIndices)}`);
  lines.push(`${indent}    uniform token subdivisionScheme = "none"`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function makeTerrainBoardMesh(name: string, materialPath: string): MeshSpec {
  return {
    name,
    materialPath,
    points: [
      [-HALF_DOMAIN_M, -0.04, -HALF_DOMAIN_M],
      [HALF_DOMAIN_M, -0.04, -HALF_DOMAIN_M],
      [HALF_DOMAIN_M, -0.04, HALF_DOMAIN_M],
      [-HALF_DOMAIN_M, -0.04, HALF_DOMAIN_M]
    ],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
    physicsCollision: true,
    customData: {
      source: "live basemap/DEM preview surface",
      note: "Satellite tiles are not cached in this package; Omniverse material should be replaced by licensed imagery/terrain layer at deployment."
    }
  };
}

function makeFloodWaterReferenceMesh(name: string, materialPath: string): MeshSpec {
  return {
    name,
    materialPath,
    points: [
      [-HALF_DOMAIN_M, 0.12, -HALF_DOMAIN_M],
      [HALF_DOMAIN_M, 0.12, -HALF_DOMAIN_M],
      [HALF_DOMAIN_M, 0.12, HALF_DOMAIN_M],
      [-HALF_DOMAIN_M, 0.12, HALF_DOMAIN_M]
    ],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
    customData: {
      role: "hydrology result layer placeholder",
      source: "GPU shallow-water runtime texture in browser MVP; export records the layer target for NVIDIA simulation replacement."
    }
  };
}

function makeBuildingMesh(building: BuildingFeature, materialPath: string): MeshSpec | null {
  const ring = cleanRing(building.footprint);
  if (!ring) return null;
  const points: Array<[number, number, number]> = [];
  for (const point of ring) points.push([point.x, 0, point.z]);
  for (const point of ring) points.push([point.x, Math.max(3, building.height_m), point.z]);

  const contour = ring.map((point) => new Vector2(point.x, -point.z));
  let triangles = ShapeUtils.triangulateShape(contour, []);
  if (triangles.length === 0 && ring.length >= 3) {
    triangles = [];
    for (let i = 1; i < ring.length - 1; i++) triangles.push([0, i, i + 1]);
  }

  const faceVertexCounts: number[] = [];
  const faceVertexIndices: number[] = [];
  const n = ring.length;
  for (const tri of triangles) {
    faceVertexCounts.push(3);
    faceVertexIndices.push(n + tri[0], n + tri[1], n + tri[2]);
  }
  for (const tri of triangles) {
    faceVertexCounts.push(3);
    faceVertexIndices.push(tri[2], tri[1], tri[0]);
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faceVertexCounts.push(4);
    faceVertexIndices.push(i, next, n + next, n + i);
  }

  return {
    name: sanitizeIdentifier(`${building.role}_${building.id}`),
    materialPath,
    points,
    faceVertexCounts,
    faceVertexIndices,
    physicsCollision: true,
    customData: {
      sourceType: building.source_type,
      confidence: building.confidence,
      displayName: building.name,
      role: building.role,
      heightM: building.height_m,
      floorsEstimate: building.floors_estimate ?? 0
    }
  };
}

function makeRoadMesh(road: RoadHint, ordinal: number, materialPath: string): MeshSpec | null {
  const segments = ribbonSegments(road.centerline, Math.max(3.5, Math.min(18, road.width_m || 5)), false, 0.06);
  if (segments.length === 0) return null;
  return meshFromQuads(sanitizeIdentifier(`road_${ordinal}_${road.name || road.id}`), segments, materialPath, {
    sourceType: road.source_type,
    confidence: road.confidence,
    displayName: road.name,
    widthM: road.width_m
  }, true);
}

function makeParcelBoundaryMesh(boundary: LocalPoint[], materialPath: string): MeshSpec | null {
  const ring = cleanRing(boundary);
  if (!ring) return null;
  const segments = ribbonSegments(ring, 0.85, true, 0.22);
  if (segments.length === 0) return null;
  return meshFromQuads("official_parcel_boundary_ribbon", segments, materialPath, {
    role: "official cadastral parcel boundary visual guide",
    sourceType: "official"
  }, true);
}

function meshFromQuads(
  name: string,
  quads: Array<Array<[number, number, number]>>,
  materialPath: string,
  customData: Record<string, string | number | boolean>,
  physicsCollision = false
): MeshSpec {
  const points: Array<[number, number, number]> = [];
  const faceVertexCounts: number[] = [];
  const faceVertexIndices: number[] = [];
  for (const quad of quads) {
    const offset = points.length;
    points.push(...quad);
    faceVertexCounts.push(4);
    faceVertexIndices.push(offset, offset + 1, offset + 2, offset + 3);
  }
  return { name, points, faceVertexCounts, faceVertexIndices, materialPath, physicsCollision, customData };
}

function ribbonSegments(points: LocalPoint[], width: number, closed: boolean, y: number): Array<Array<[number, number, number]>> {
  const quads: Array<Array<[number, number, number]>> = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue;
    const px = (-dz / length) * (width / 2);
    const pz = (dx / length) * (width / 2);
    quads.push([
      [a.x + px, y, a.z + pz],
      [b.x + px, y, b.z + pz],
      [b.x - px, y, b.z - pz],
      [a.x - px, y, a.z - pz]
    ]);
  }
  return quads;
}

function cleanRing(points: LocalPoint[]): LocalPoint[] | null {
  const ring: LocalPoint[] = [];
  for (const point of points ?? []) {
    const previous = ring[ring.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.03) continue;
    ring.push({ x: point.x, z: point.z });
  }
  while (ring.length > 1 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].z - ring[ring.length - 1].z) < 0.03) ring.pop();
  if (ring.length < 3) return null;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.x * b.z - b.x * a.z;
  }
  if (Math.abs(area / 2) < 0.5) return null;
  if (area > 0) ring.reverse();
  return ring;
}

function buildStackManifest(
  twin: TwinProject,
  manifest: SourceManifest,
  runtimeProbe: LocalRuntimeProbe,
  meshes: MeshSpec[],
  generatedAt: string
): object {
  return {
    project_id: twin.project_id,
    generated_at: generatedAt,
    source_artifacts: {
      twin_json: "../twin.json",
      source_manifest_json: "../source_manifest.json"
    },
    nvidia_only_target_stack: [
      {
        product: "OpenUSD",
        role: "Canonical authored scene interchange for terrain, official buildings, roads, parcel boundary, and hydrology layers.",
        status: "authored"
      },
      {
        product: "NVIDIA Omniverse / RTX Renderer / ovrtx",
        role: "Required renderer/viewer target for the generated USD stage; browser WebGL is not the final NVIDIA path.",
        status: runtimeProbe.nvidiaSmi === "available" ? "runtime_check_required" : "blocked_missing_local_nvidia_runtime"
      },
      {
        product: "NVIDIA SimReady",
        role: "Conformance target for simulation-ready materials, units, metadata, and physics semantics.",
        status: "minimum_candidate_authored"
      },
      {
        product: "Omniverse Content Agents",
        role: "Future automated material and physics assignment for SimReady conformance.",
        status: "not_run_requires_nvidia_api_key_gpu_docker"
      },
      {
        product: "Omniverse USD Performance Tuning / Asset Validator / Scene Optimizer",
        role: "Future validation, profiling, and optimization gates for large USD scenes.",
        status: runtimeProbe.usdChecker === "available" || runtimeProbe.usdPython === "available" ? "partial_runtime_available" : "blocked_missing_usd_runtime"
      },
      {
        product: "NVIDIA cuOpt",
        role: "Optional emergency routing, inspection route, and drainage operation optimization layer.",
        status: "planned_not_needed_for_static_usd_export"
      },
      {
        product: "NVIDIA Physical AI Neural Reconstruction / NuRec",
        role: "Optional future camera/LiDAR reconstruction path for replacing preview massing with captured scene assets.",
        status: "planned_requires_sensor_data"
      }
    ],
    source_quality: {
      geocoding_provider: manifest.geocoding.provider,
      confidence: manifest.geocoding.confidence,
      official_buildings: twin.buildings.filter((building) => building.source_type === "official").length,
      official_roads: twin.roads.filter((road) => road.source_type === "official").length,
      official_parcel: twin.parcel.source_type === "official",
      spatial_reference: twin.spatial_reference ?? null
    },
    stage_summary: {
      openusd_stage: `${twin.project_id}.usda`,
      mesh_count: meshes.length,
      building_meshes: twin.buildings.length,
      road_meshes: twin.roads.length,
      physics_collision_meshes: countPhysicsCollisionMeshes(meshes),
      physics_scene: "PhysicsScene with earth gravity",
      meters_per_unit: 1,
      up_axis: "Y"
    },
    local_runtime_probe: runtimeProbe
  };
}

function buildSimReadyMinimumReport(
  twin: TwinProject,
  manifest: SourceManifest,
  runtimeProbe: LocalRuntimeProbe,
  meshes: MeshSpec[],
  generatedAt: string
): object {
  const checks = [
    { id: "USD.UNITS.001", status: "passed", evidence: "Root layer authors metersPerUnit = 1." },
    { id: "USD.AXIS.001", status: "passed", evidence: "Root layer authors upAxis = Y." },
    { id: "USD.DEFAULT_PRIM.001", status: "passed", evidence: `defaultPrim = ${sanitizeIdentifier(twin.project_id)}.` },
    { id: "USD.MATERIAL_BINDING.001", status: "passed", evidence: `${meshes.length} generated meshes include material:binding relationships.` },
    { id: "SIMREADY.PHYSICS_SCENE.001", status: "passed", evidence: "A USD PhysicsScene is authored with earth gravity in the meter-based Y-up stage." },
    { id: "SIMREADY.PHYSICS_COLLISION_BASELINE.001", status: "passed", evidence: `${countPhysicsCollisionMeshes(meshes)} static terrain/building/road/parcel meshes include PhysicsCollisionAPI and physics:collisionEnabled=true; the flood-water result layer remains non-colliding.` },
    { id: "SRC.OFFICIAL_GEOMETRY.001", status: "passed", evidence: `${twin.buildings.filter((building) => building.source_type === "official").length} official building footprints, ${twin.roads.filter((road) => road.source_type === "official").length} official roads, parcel=${twin.parcel.source_type}.` },
    { id: "SIMREADY.CONTENT_AGENTS.001", status: "blocked", evidence: "Material/Physics Content Agents were not run in this local environment; requires NVIDIA_API_KEY, Docker, NVIDIA Container Toolkit, and NVIDIA GPU or provided endpoints." },
    { id: "OVRTX.RENDER.001", status: runtimeProbe.nvidiaSmi === "available" ? "not_run" : "blocked", evidence: runtimeProbe.nvidiaSmi === "available" ? "NVIDIA GPU detected but ovrtx render service still needs explicit setup." : "No local nvidia-smi runtime was detected on this workstation." },
    { id: "USD.RUNTIME_VALIDATOR.001", status: runtimeProbe.usdChecker === "available" ? "not_run" : "blocked", evidence: runtimeProbe.usdChecker === "available" ? "usdchecker exists; run external validation on the generated stage." : "usdchecker was not found locally." }
  ];
  return {
    project_id: twin.project_id,
    generated_at: generatedAt,
    status: "minimum_openusd_candidate_authored",
    simready_profile_target: "Prop-Robotics-Neutral / site digital-twin candidate",
    source_manifest_confidence: manifest.geocoding.confidence,
    checks,
    next_runtime_commands: [
      "Open the .usda in NVIDIA Omniverse or an ovrtx-based USD viewer.",
      "Run Omniverse Asset Validator / SimReady validation on an NVIDIA runtime host.",
      "Run Content Agents material/physics assignment before claiming full SimReady conformance; this package only authors a conservative static-collider baseline.",
      "Run USD Performance Tuning baseline/after profiling once the stage grows beyond this MVP sample."
    ]
  };
}

function countPhysicsCollisionMeshes(meshes: MeshSpec[]): number {
  return meshes.filter((mesh) => mesh.physicsCollision).length;
}

function buildPackageReadme(twin: TwinProject, runtimeProbe: LocalRuntimeProbe): string {
  return `# ${twin.project_id} NVIDIA Omniverse Package

This folder is the NVIDIA-targeted export of the address digital twin. It is authored as OpenUSD for Omniverse/RTX workflows; it is not a browser-side Three.js runtime.

## Files

- \`${twin.project_id}.usda\` — OpenUSD ASCII stage with official building, road, parcel, terrain-reference, and flood-water layer prims.
- \`${twin.project_id}.ovrtx_viewer.usda\` — viewer/session wrapper that sublayers the source stage and adds NVIDIA ovrtx Camera → RenderProduct → RenderVar → RenderSettings wiring.
- \`nvidia_ovrtx_first_frame.py\` — GPU-host ovrtx smoke script that renders the wrapper through NVIDIA RTX and saves first-frame evidence.
- \`nvidia_ovstream_smoke_server.py\` — GPU-host smoke server that converts ovrtx \`LdrColor\` to a persistent BGRA CUDA buffer, starts ovstream WebRTC, and gates \`/healthz\` on the first converted frame.
- \`nvidia_stack_manifest.json\` — product mapping and runtime gate status.
- \`nvidia_runtime_preflight.json\` / \`.md\` — local NVIDIA/Omniverse/SimReady runtime gate probe.
- \`simready_minimum_report.json\` — minimum SimReady-candidate checks and blocked external gates.
- \`usdchecker_report.txt\` — local USD checker output when \`usdchecker\` is available.
- \`handoff_manifest.json\` — SHA-256 file inventory for moving the package to an NVIDIA GPU host.
- \`NVIDIA_GPU_HOST_RUNBOOK.md\` — concrete GPU-host validation/runbook steps.
- \`ovstream_viewer_contract.json\` — browser viewer contract: NVIDIA ovrtx/Omniverse server renders, browser displays ovstream WebRTC video only.
- \`OVSTREAM_VIEWER_RUNBOOK.md\` — GPU-host steps for the browser-delivered NVIDIA-only viewer.

## Local runtime probe

\`nvidia-smi\`: ${runtimeProbe.nvidiaSmi}
\`docker\`: ${runtimeProbe.docker}
\`python pxr\`: ${runtimeProbe.usdPython}
\`usdchecker\`: ${runtimeProbe.usdChecker}

${runtimeProbe.note}

## Intended NVIDIA flow

1. Open \`${twin.project_id}.ovrtx_viewer.usda\` with NVIDIA Omniverse / ovrtx for first-frame validation, or open \`${twin.project_id}.usda\` directly in Omniverse tools. The source stage already includes a USD PhysicsScene and conservative static collision APIs for terrain/buildings/roads/parcel geometry.
2. Expose browser delivery through ovstream/WebRTC only; browser WebGL/Three.js is not NVIDIA-only acceptance evidence.
3. Run Omniverse Asset Validator and SimReady validation.
4. Run Omniverse Content Agents for material and physics assignment when a GPU/Docker/NVIDIA_API_KEY runtime is available.
5. Use Omniverse USD Performance Tuning for large scene profiling and optimization.
6. Add cuOpt only for operational routing/dispatch optimization; add NuRec only when camera/LiDAR captures exist.

## GPU-host first-frame smoke

\`\`\`bash
export OVRTX_SKIP_USD_CHECK=1
python3 nvidia_ovrtx_first_frame.py --stage ${twin.project_id}.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm
python3 nvidia_ovstream_smoke_server.py --stage ${twin.project_id}.ovrtx_viewer.usda --output-json ovstream_smoke_report.json
\`\`\`
`;
}

function sanitizeIdentifier(raw: string): string {
  const ascii = raw.normalize("NFKD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const fallback = ascii || "Prim";
  return /^[A-Za-z_]/.test(fallback) ? fallback : `_${fallback}`;
}

function renderVec3Array(points: Array<[number, number, number]>, indent: string): string {
  if (points.length <= 4) return `[${points.map(renderVec3).join(", ")}]`;
  return `[\n${indent}    ${points.map(renderVec3).join(`,\n${indent}    `)}\n${indent}]`;
}

function renderVec3(point: [number, number, number]): string {
  return `(${fmt(point[0])}, ${fmt(point[1])}, ${fmt(point[2])})`;
}

function renderNumberArray(values: number[]): string {
  return `[${values.map((value) => String(value)).join(", ")}]`;
}

function usdValue(value: string | number | boolean): string {
  if (typeof value === "string") return q(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fmt(value);
}

function q(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}
