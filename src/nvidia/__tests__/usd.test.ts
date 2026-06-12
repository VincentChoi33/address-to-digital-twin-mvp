import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import { exportTwinToOmniversePackage } from "../usd";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;

const exported = exportTwinToOmniversePackage(twin, manifest, {
  nvidiaSmi: "missing",
  docker: "missing",
  usdPython: "missing",
  usdChecker: "missing",
  note: "test probe"
});

describe("OpenUSD/Omniverse export", () => {
  it("authors a meter-based Y-up OpenUSD stage with NVIDIA workflow metadata", () => {
    expect(exported.usda).toContain("#usda 1.0");
    expect(exported.usda).toContain("metersPerUnit = 1");
    expect(exported.usda).toContain('upAxis = "Y"');
    expect(exported.usda).toContain("OpenUSD -> Omniverse RTX/ovrtx -> SimReady validation candidate");
    expect(exported.usda).toContain("def Scope \"Looks\"");
    expect(exported.usda).toContain('def PhysicsScene "PhysicsScene"');
    expect(exported.usda).toContain("SimReady_Metadata");
  });

  it("exports official target, context, road, parcel, and flood layer prims", () => {
    expect(exported.summary.buildingMeshes).toBe(twin.buildings.length);
    expect(exported.summary.roadMeshes).toBe(twin.roads.length);
    expect(exported.usda).toContain("Official_Target_Building_Teal");
    expect(exported.usda).toContain("Official_Context_Building_Concrete");
    expect(exported.usda).toContain("official_parcel_boundary_ribbon");
    expect(exported.usda).toContain("FloodScenario_Cloudburst_WaterReference");
    expect(exported.usda).toContain("rel material:binding");
    expect(exported.usda).toContain("rel material:binding:physics");
    expect(exported.usda).toContain("PhysicsMaterialAPI");
    expect(exported.usda).toContain("PhysicsRigidBodyAPI");
    expect(exported.usda).toContain("PhysicsMassAPI");
    expect(exported.usda).toContain("physics:mass");
    expect(exported.usda).toContain('def BasisCurves "grasp_identifier_site_axis"');
    expect(exported.usda).toContain('purpose = "guide"');
    expect(exported.usda).toContain('prepend apiSchemas = ["MaterialBindingAPI", "PhysicsCollisionAPI"]');
    expect(exported.usda).toContain("bool physics:collisionEnabled = true");
  });

  it("reports external NVIDIA runtime gates instead of pretending Content Agents ran", () => {
    const report = exported.simreadyReport as { checks: Array<{ id: string; status: string }> };
    expect(report.checks.find((check) => check.id === "SIMREADY.PHYSICS_SCENE.001")?.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "SIMREADY.PHYSICS_COLLISION_BASELINE.001")?.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "SIMREADY.CONTENT_AGENTS.001")?.status).toBe("blocked");
    expect(report.checks.find((check) => check.id === "OVRTX.RENDER.001")?.status).toBe("blocked");
    expect(JSON.stringify(exported.stackManifest)).toContain("NVIDIA Omniverse / RTX Renderer / ovrtx");
    expect(JSON.stringify(exported.stackManifest)).toContain("OpenUSD");
    expect(JSON.stringify(exported.simreadyMetadata)).toContain("Prop-Robotics-Neutral");
  });
});
