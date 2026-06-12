import { describe, expect, it } from "vitest";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { TwinProject } from "../../types/twin";
import { buildOvrtxCompositeStage, OVRTX_RENDER_PRODUCT_PATH } from "../ovrtxComposite";

const twin = sadangTwin as unknown as TwinProject;

describe("NVIDIA ovrtx composite wrapper", () => {
  it("authors a viewer-owned Camera -> RenderProduct -> RenderVar -> RenderSettings pipeline", () => {
    const composite = buildOvrtxCompositeStage(twin, { sceneFileName: `${twin.project_id}.usda`, width: 1280, height: 720 });

    expect(composite.fileName).toBe(`${twin.project_id}.ovrtx_viewer.usda`);
    expect(composite.renderProductPath).toBe(OVRTX_RENDER_PRODUCT_PATH);
    expect(composite.usda).toContain(`@${twin.project_id}.usda@`);
    expect(composite.usda).toContain('def Camera "OVCamera"');
    expect(composite.usda).toContain('def RenderProduct "ViewportTexture0"');
    expect(composite.usda).toContain('def RenderVar "LdrColor"');
    expect(composite.usda).toContain('def RenderSettings "OVRenderSettings"');
    expect(composite.usda).toContain('rel products = [</Render/OVServer/ViewportTexture0>]');
    expect(composite.usda).toContain('uniform int2 resolution = (1280, 720)');
  });

  it("keeps the browser-renderer shortcuts out of the ovrtx wrapper", () => {
    const composite = buildOvrtxCompositeStage(twin, { sceneFileName: `${twin.project_id}.usda` });

    expect(composite.usda).not.toContain("Three.js");
    expect(composite.usda).not.toContain("WebGL");
    expect(composite.camera.rotateXYZ[0]).toBeLessThan(0);
    expect(composite.camera.translate[1]).toBeGreaterThan(composite.camera.focus[1]);
  });
});
