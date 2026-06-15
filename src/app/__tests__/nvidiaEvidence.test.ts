import { describe, expect, it } from "vitest";
import { getNvidiaEvidenceSummary, getNvidiaVisualArtifacts, nvidiaEvidenceHtml } from "../nvidiaEvidence";

describe("NVIDIA evidence summary", () => {
  it("surfaces the actual NVIDIA acceptance path instead of hiding it behind the preview UI", () => {
    const summary = getNvidiaEvidenceSummary();
    expect(summary.acceptanceStatus).toBe("passed");
    expect(summary.passedGateCount).toBe(summary.totalGateCount);
    expect(summary.workflow).toContain("OpenUSD");
    expect(summary.materialPredictions).toBeGreaterThan(0);
    expect(summary.physicsRenderedImages).toBeGreaterThan(0);
    expect(summary.warpEvidence).toContain("cuda_device");
  });

  it("exposes actual NVIDIA visual outputs that the UI can switch between", () => {
    const visuals = getNvidiaVisualArtifacts();
    expect(visuals.map((visual) => visual.id)).toEqual(["fused", "ovrtx", "ovstream", "warp"]);
    expect(visuals[0].fused).toBe(true);
    expect(visuals[0].imageUrl).toContain("nvidia-train1-ovrtx-first-frame");
    expect(visuals[0].warpOverlayUrl).toContain("nvidia-train1-warp-flood-depth");
    expect(visuals[1].imageUrl).toContain("nvidia-train1-ovrtx-first-frame");
    expect(visuals[2].imageUrl).toContain("nvidia-train1-ovstream-browser-first-frame");
    expect(visuals[3].imageUrl).toContain("nvidia-train1-warp-flood-depth");
    for (const visual of visuals) {
      expect(visual.status).toBe("passed");
      expect(visual.caption.length).toBeGreaterThan(20);
    }
  });

  it("renders a Korean-facing evidence panel with caveats and visual selectors", () => {
    const html = nvidiaEvidenceHtml();
    expect(html).toContain("NVIDIA-only main result");
    expect(html).toContain("기본 메인 화면은 train1에서 생성한 NVIDIA 결과");
    expect(html).toContain("Physics Agent");
    expect(html).toContain(`data-nvidia-visual="fused"`);
    expect(html).toContain(`data-nvidia-visual="ovrtx"`);
    expect(html).toContain(`data-nvidia-visual="ovstream"`);
    expect(html).toContain(`data-nvidia-visual="warp"`);
  });
});
