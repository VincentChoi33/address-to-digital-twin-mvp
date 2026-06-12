import type { LocalPoint, TwinProject } from "../types/twin";

export const OVRTX_CAMERA_PATH = "/OVCamera";
export const OVRTX_RENDER_PRODUCT_PATH = "/Render/OVServer/ViewportTexture0";
export const OVRTX_COMPOSITE_SUFFIX = ".ovrtx_viewer.usda";

export interface OvrtxCompositeOptions {
  sceneFileName: string;
  width?: number;
  height?: number;
  includeViewerLighting?: boolean;
}

export interface OvrtxCompositeResult {
  usda: string;
  fileName: string;
  renderProductPath: typeof OVRTX_RENDER_PRODUCT_PATH;
  cameraPath: typeof OVRTX_CAMERA_PATH;
  width: number;
  height: number;
  camera: {
    translate: [number, number, number];
    rotateXYZ: [number, number, number];
    focus: [number, number, number];
  };
}

const CAMERA_HORIZONTAL_APERTURE = 20.955;
const CAMERA_FOCAL_LENGTH = 18.15;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

export function buildOvrtxCompositeStage(twin: TwinProject, options: OvrtxCompositeOptions): OvrtxCompositeResult {
  const width = positiveInteger(options.width, DEFAULT_WIDTH);
  const height = positiveInteger(options.height, DEFAULT_HEIGHT);
  const sceneFileName = options.sceneFileName;
  const fileName = `${twin.project_id}${OVRTX_COMPOSITE_SUFFIX}`;
  const camera = fitCameraToPrimarySite(twin);
  const verticalAperture = CAMERA_HORIZONTAL_APERTURE * (height / width);
  const includeViewerLighting = options.includeViewerLighting ?? true;

  const lines: string[] = [];
  lines.push("#usda 1.0");
  lines.push("(");
  lines.push(`    defaultPrim = "${sanitizeIdentifier(twin.project_id)}"`);
  lines.push("    metersPerUnit = 1");
  lines.push("    upAxis = \"Y\"");
  lines.push("    subLayers = [");
  lines.push(`        @${escapeAssetPath(sceneFileName)}@`);
  lines.push("    ]");
  lines.push(")");
  lines.push("");
  lines.push("def Camera \"OVCamera\"");
  lines.push("{");
  lines.push("    float2 clippingRange = (0.1, 10000000)");
  lines.push(`    float focalLength = ${fmt(CAMERA_FOCAL_LENGTH)}`);
  lines.push(`    float horizontalAperture = ${fmt(CAMERA_HORIZONTAL_APERTURE)}`);
  lines.push(`    float verticalAperture = ${fmt(verticalAperture)}`);
  lines.push("    token projection = \"perspective\"");
  lines.push(`    double3 xformOp:translate = (${camera.translate.map(fmt).join(", ")})`);
  lines.push(`    double3 xformOp:rotateXYZ = (${camera.rotateXYZ.map(fmt).join(", ")})`);
  lines.push("    uniform token[] xformOpOrder = [\"xformOp:translate\", \"xformOp:rotateXYZ\"]");
  lines.push("}");
  lines.push("");
  if (includeViewerLighting) {
    lines.push("def Scope \"ViewerLighting\"");
    lines.push("{");
    lines.push("    def DistantLight \"OVSunKey\"");
    lines.push("    {");
    lines.push("        float intensity = 650");
    lines.push("        float angle = 0.8");
    lines.push("        double3 xformOp:rotateXYZ = (-48, 0, -32)");
    lines.push("        uniform token[] xformOpOrder = [\"xformOp:rotateXYZ\"]");
    lines.push("    }");
    lines.push("}");
    lines.push("");
  }
  lines.push("def \"Render\"");
  lines.push("{");
  lines.push("    def \"OVServer\"");
  lines.push("    {");
  lines.push("        def RenderProduct \"ViewportTexture0\" (");
  lines.push("            prepend apiSchemas = [\"OmniRtxSettingsCommonAdvancedAPI_1\", \"OmniRtxSettingsPtAdvancedAPI_1\", \"OmniRtxSettingsRtAdvancedAPI_1\"]");
  lines.push("        )");
  lines.push("        {");
  lines.push("            token omni:rtx:rendermode = \"RealTimePathTracing\"");
  lines.push("            bool omni:rtx:pt:diAOV = 1");
  lines.push("            bool omni:rtx:pt:giAOV = 1");
  lines.push("            bool omni:rtx:pt:diffuseFilterAOV = 1");
  lines.push("            bool omni:rtx:pt:reflectionsAOV = 1");
  lines.push("            bool omni:rtx:pt:refractionFilterAOV = 1");
  lines.push("            bool omni:rtx:pt:refractionsAOV = 1");
  lines.push("            bool omni:rtx:pt:selfIllumAOV = 1");
  lines.push("            bool omni:rtx:pt:volumesAOV = 1");
  lines.push("            bool omni:rtx:pt:worldNormalsAOV = 1");
  lines.push("            bool omni:rtx:pt:worldPosAOV = 1");
  lines.push("            bool omni:rtx:pt:zDepthAOV = 1");
  lines.push("            bool omni:rtx:pt:denoising:optix:denoiseAOVs = 1");
  lines.push("            float omni:rtx:pt:zDepthMin = 0.1");
  lines.push("            float omni:rtx:pt:zDepthMax = 10000");
  lines.push(`            int omni:rtx:pt:maxSamplesPerLaunch = ${width * height}`);
  lines.push("            float omni:rtx:rtpt:modulatingRoughnessThreshold = 0.08");
  lines.push(`            rel camera = <${OVRTX_CAMERA_PATH}>`);
  lines.push("            rel orderedVars = [");
  lines.push("                </Render/Vars/LdrColor>");
  lines.push("            ]");
  lines.push(`            uniform int2 resolution = (${width}, ${height})`);
  lines.push("        }");
  lines.push("    }");
  lines.push("");
  lines.push("    def \"Vars\"");
  lines.push("    {");
  lines.push("        def RenderVar \"LdrColor\"");
  lines.push("        {");
  lines.push("            uniform string sourceName = \"LdrColor\"");
  lines.push("        }");
  lines.push("    }");
  lines.push("");
  lines.push("    def RenderSettings \"OVRenderSettings\"");
  lines.push("    {");
  lines.push(`        rel products = [<${OVRTX_RENDER_PRODUCT_PATH}>]`);
  lines.push("    }");
  lines.push("}");
  lines.push("");

  return {
    usda: `${lines.join("\n")}\n`,
    fileName,
    renderProductPath: OVRTX_RENDER_PRODUCT_PATH,
    cameraPath: OVRTX_CAMERA_PATH,
    width,
    height,
    camera
  };
}

function fitCameraToPrimarySite(twin: TwinProject): OvrtxCompositeResult["camera"] {
  const points = [...twin.buildings.flatMap((building) => building.footprint), ...twin.parcel.boundary];
  const bounds = boundsFor(points);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 80);
  const targetY = Math.max(4, Math.min(18, maxBuildingHeight(twin) * 0.35));
  const distance = Math.max(170, span * 2.2);
  const height = Math.max(95, span * 0.95 + targetY + 24);
  const pitchDegrees = -toDegrees(Math.atan2(height - targetY, distance));
  return {
    focus: [centerX, targetY, centerZ],
    translate: [centerX, height, centerZ + distance],
    rotateXYZ: [pitchDegrees, 0, 0]
  };
}

function boundsFor(points: LocalPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (points.length === 0) return { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function maxBuildingHeight(twin: TwinProject): number {
  return twin.buildings.reduce((max, building) => Math.max(max, building.height_m), 0);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function escapeAssetPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/@/g, "@@");
}

function sanitizeIdentifier(raw: string): string {
  const ascii = raw.normalize("NFKD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const fallback = ascii || "Prim";
  return /^[A-Za-z_]/.test(fallback) ? fallback : `_${fallback}`;
}

function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}
