import { describe, expect, it } from "vitest";
import { buildPreviewTwin, projectIdFromQuery } from "../previewTwin";

describe("projectIdFromQuery", () => {
  it("keeps Korean syllables intact (NFC, not NFKD-decomposed)", () => {
    expect(projectIdFromQuery("서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘")).toBe(
      "서울_강남구_테헤란로_152"
    );
  });

  it("strips request phrasing and falls back when nothing remains", () => {
    expect(projectIdFromQuery("디지털 트윈 만들어줘")).toBe("address_twin_preview");
  });
});

describe("buildPreviewTwin", () => {
  it("produces a renderable offline twin for an arbitrary address", () => {
    const { twin, manifest } = buildPreviewTwin("부산 해운대구 우동 1408");
    expect(twin.buildings.some((building) => building.role === "target")).toBe(true);
    expect(twin.roads.length).toBeGreaterThan(0);
    expect(twin.geocoding.provider).toBe("fallback");
    expect(manifest.project_id).toBe(twin.project_id);
    expect(manifest.layers.map((layer) => layer.name)).toContain("spatial_reference");
    expect(manifest.layers.length).toBeGreaterThanOrEqual(5);
  });

  it("is deterministic for the same query", () => {
    const a = buildPreviewTwin("서울 송파구 올림픽로 300");
    const b = buildPreviewTwin("서울 송파구 올림픽로 300");
    expect(a.twin.center).toEqual(b.twin.center);
    expect(a.twin.buildings.map((x) => x.footprint)).toEqual(b.twin.buildings.map((x) => x.footprint));
  });

  it("varies procedural massing across different addresses", () => {
    const a = buildPreviewTwin("서울 송파구 올림픽로 300");
    const b = buildPreviewTwin("인천 연수구 송도과학로 32");
    expect(JSON.stringify(a.twin.buildings)).not.toBe(JSON.stringify(b.twin.buildings));
  });
});
