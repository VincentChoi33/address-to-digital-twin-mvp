import { describe, expect, it } from "vitest";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { TwinProject } from "../../types/twin";
import { buildSourceManifest } from "../manifest";
import { generateQaReport } from "../qa";

const twin = sadangTwin as unknown as TwinProject;

describe("buildSourceManifest", () => {
  it("copies project identity and geocoding summary from the twin", () => {
    const manifest = buildSourceManifest(twin);
    expect(manifest.project_id).toBe(twin.project_id);
    expect(manifest.geocoding.provider).toBe(twin.geocoding.provider);
    expect(manifest.geocoding.confidence).toBe(twin.geocoding.confidence);
  });

  it("records the five standard layers", () => {
    const manifest = buildSourceManifest(twin);
    expect(manifest.layers.map((layer) => layer.name)).toEqual([
      "satellite_ground",
      "target_building_massing",
      "surrounding_context_massing",
      "parcel_boundary",
      "road_hints"
    ]);
  });

  it("marks the target layer as procedural fallback when no official geometry exists", () => {
    const manifest = buildSourceManifest(twin);
    const targetLayer = manifest.layers.find((layer) => layer.name === "target_building_massing");
    expect(targetLayer?.source).toBe("procedural fallback");
    expect(targetLayer?.confidence).toBe("low");
  });

  it("always declares preview limitations and next actions", () => {
    const manifest = buildSourceManifest(twin);
    expect(manifest.limitations.length).toBeGreaterThan(0);
    expect(manifest.limitations).toContain("Not survey-grade");
    expect(manifest.next_actions.length).toBeGreaterThan(0);
  });
});

describe("generateQaReport", () => {
  it("renders a full HTML report with project metadata", () => {
    const manifest = buildSourceManifest(twin);
    const html = generateQaReport(twin, manifest);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(twin.project_id);
    expect(html).toContain("측량급 또는 법적 효력이 있는 디지털 트윈이 아닙니다");
  });

  it("renders one table row per manifest layer", () => {
    const manifest = buildSourceManifest(twin);
    const html = generateQaReport(twin, manifest);
    for (const layer of manifest.layers) {
      expect(html).toContain(layer.name);
    }
  });

  it("escapes HTML in user-controlled fields", () => {
    const hostileTwin: TwinProject = {
      ...twin,
      project_id: `<img src=x onerror="alert(1)">`,
      input: { ...twin.input, raw_query: `<script>alert("xss")</script>` }
    };
    const manifest = buildSourceManifest(hostileTwin);
    const html = generateQaReport(hostileTwin, manifest);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain(`<img src=x`);
    expect(html).toContain("&lt;script&gt;");
  });

  it("states when no official geometry was used", () => {
    const manifest = buildSourceManifest(twin);
    const html = generateQaReport(twin, manifest);
    expect(html).toContain("공식 geometry 없이 프리뷰용으로 생성");
  });
});
