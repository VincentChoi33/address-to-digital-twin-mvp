import { describe, expect, it } from "vitest";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { TwinProject } from "../../types/twin";
import { buildSourceManifest } from "../manifest";
import { buildPreviewTwin } from "../previewTwin";
import { generateQaReport } from "../qa";

const twin = sadangTwin as unknown as TwinProject;
const fallbackTwin = buildPreviewTwin("부산 해운대구 우동 1408 디지털 트윈 프리뷰").twin;

describe("buildSourceManifest", () => {
  it("copies project identity and geocoding summary from the twin", () => {
    const manifest = buildSourceManifest(twin);
    expect(manifest.project_id).toBe(twin.project_id);
    expect(manifest.geocoding.provider).toBe(twin.geocoding.provider);
    expect(manifest.geocoding.confidence).toBe(twin.geocoding.confidence);
  });

  it("records the standard confidence layers, including spatial reference when available", () => {
    const manifest = buildSourceManifest(twin);
    expect(manifest.layers.map((layer) => layer.name)).toContain("satellite_ground");
    expect(manifest.layers.map((layer) => layer.name)).toContain("target_building_massing");
    expect(manifest.layers.map((layer) => layer.name)).toContain("surrounding_context_massing");
    expect(manifest.layers.map((layer) => layer.name)).toContain("parcel_boundary");
    expect(manifest.layers.map((layer) => layer.name)).toContain("road_hints");
    expect(manifest.layers.map((layer) => layer.name)).toContain("spatial_reference");
  });

  it("marks the WFS Sadang target as official geometry", () => {
    const manifest = buildSourceManifest(twin);
    const targetLayer = manifest.layers.find((layer) => layer.name === "target_building_massing");
    expect(targetLayer?.source).toBe("official footprint/attributes");
    expect(targetLayer?.confidence).toBe("high");
  });

  it("still marks generated fallback twins as procedural when no official geometry exists", () => {
    const manifest = buildSourceManifest(fallbackTwin);
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
    const manifest = buildSourceManifest(fallbackTwin);
    const html = generateQaReport(fallbackTwin, manifest);
    expect(html).toContain("공식 geometry 없이 프리뷰용으로 생성");
  });

  it("states which official geometry exists when WFS data is connected", () => {
    const manifest = buildSourceManifest(twin);
    const html = generateQaReport(twin, manifest);
    expect(html).toContain("대상 건물 footprint");
    expect(html).toContain("필지 경계");
  });
});
