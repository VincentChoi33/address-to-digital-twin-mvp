import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import { buildPreviewTwin } from "../../core/previewTwin";
import type { SourceManifest, TwinProject } from "../../types/twin";
import {
  confidenceKo,
  coordinateText,
  dataReadinessSummary,
  floodRiskSummary,
  geocodingStatusKo,
  layerRows,
  rainLabelText,
  scenarioNarrativeText
} from "../ui";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;
const fallbackManifest = buildPreviewTwin("부산 해운대구 우동 1408").manifest;

describe("ui helpers", () => {
  it("translates confidence levels to Korean", () => {
    expect(confidenceKo("high")).toBe("높음");
    expect(confidenceKo("medium")).toBe("중간");
    expect(confidenceKo("low")).toBe("낮음");
    expect(confidenceKo("unknown")).toBe("낮음");
  });

  it("describes geocoding providers", () => {
    expect(geocodingStatusKo("vworld")).toContain("VWorld");
    expect(geocodingStatusKo("nominatim")).toContain("Nominatim");
    expect(geocodingStatusKo("fallback")).toContain("미연결");
  });

  it("formats the center coordinate", () => {
    const text = coordinateText(twin);
    expect(text).toContain(twin.center.lat.toFixed(5));
    expect(text).toContain(twin.center.lon.toFixed(5));
  });

  it("labels rain intensity bands", () => {
    expect(rainLabelText(0)).toContain("맑음");
    expect(rainLabelText(40)).toContain("약한 강우");
    expect(rainLabelText(80)).toContain("집중호우");
    expect(rainLabelText(140)).toContain("극한 폭우");
  });

  it("renders one row per manifest layer", () => {
    const html = layerRows(manifest);
    const rowCount = (html.match(/class="layer-row"/g) ?? []).length;
    expect(rowCount).toBe(manifest.layers.length);
    for (const layer of manifest.layers) {
      expect(html).toContain(layer.name);
    }
  });

  it("summarizes official sample readiness as ready", () => {
    const summary = dataReadinessSummary(manifest);
    expect(summary.tone).toBe("ready");
    expect(summary.label).toContain("검증");
    expect(summary.score).toBeGreaterThanOrEqual(78);
  });

  it("summarizes fallback manifest readiness without hiding preview-grade layers", () => {
    const summary = dataReadinessSummary(fallbackManifest);
    expect(summary.tone).toBe("preview");
    expect(summary.label).toContain("프리뷰");
    expect(summary.score).toBeGreaterThan(0);
    expect(summary.detail).toContain("low-confidence");
  });

  it("explains scenario narratives for presets and manual rain", () => {
    expect(scenarioNarrativeText("clear", 0)).toContain("기준 상태");
    expect(scenarioNarrativeText("cloudburst", 140)).toContain("맨홀 역류");
    expect(scenarioNarrativeText("manual", 42)).toContain("42mm/h");
  });

  it("classifies flood risk from live statistics", () => {
    expect(floodRiskSummary(null, 0, false).level).toBe("standby");
    expect(floodRiskSummary({ floodedAreaM2: 150, maxDepthM: 0.09, volumeM3: 45 }, 0.2, false).level).toBe("watch");
    expect(floodRiskSummary({ floodedAreaM2: 1200, maxDepthM: 0.18, volumeM3: 120 }, 0.9, false).level).toBe("warning");
    expect(floodRiskSummary({ floodedAreaM2: 900, maxDepthM: 0.2, volumeM3: 160 }, 0.6, true).level).toBe("critical");
  });
});
