import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import { runLocalAddressAgent } from "../agent";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;

describe("runLocalAddressAgent", () => {
  it("matches the Sadang sample by parcel number and attaches twin data", () => {
    const run = runLocalAddressAgent("사당동 317-6번지 디지털 트윈 만들어줘", twin, manifest);
    expect(run.twin).toBeDefined();
    expect(run.manifest).toBeDefined();
    expect(run.recognizedAddress).toContain(twin.addresses.parcel_address);
  });

  it("matches the Sadang sample by road address and building name", () => {
    for (const query of ["사당로20가길 39 트윈", "행복이가득한집 보여줘"]) {
      const run = runLocalAddressAgent(query, twin, manifest);
      expect(run.twin, query).toBeDefined();
    }
  });

  it("keeps out-of-sample addresses as preview-only without twin data", () => {
    const run = runLocalAddressAgent("서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘", twin, manifest);
    expect(run.twin).toBeUndefined();
    expect(run.manifest).toBeUndefined();
    expect(run.confidence).toBe("low");
    expect(run.recognizedAddress).toContain("테헤란로 152");
  });

  it("detects official-data intent from precision keywords", () => {
    expect(runLocalAddressAgent("사당동 317-6 공식 디지털 트윈", twin, manifest).intent).toBe("official_required");
    expect(runLocalAddressAgent("사당동 317-6 측량 결과 필요", twin, manifest).intent).toBe("official_required");
    expect(runLocalAddressAgent("사당동 317-6 프리뷰", twin, manifest).intent).toBe("preview");
  });

  it("falls back to the default Sadang prompt for empty queries", () => {
    const run = runLocalAddressAgent("   ", twin, manifest);
    expect(run.query).toBe("사당동 317-6번지 디지털 트윈 만들어줘");
    expect(run.twin).toBeDefined();
  });

  it("always links the four generated artifacts", () => {
    const run = runLocalAddressAgent("사당동 317-6", twin, manifest);
    expect(run.outputLinks.map((link) => link.kind).sort()).toEqual(["data", "manifest", "preview", "qa"]);
  });

  it("reports the deterministic local agent as the model", () => {
    const run = runLocalAddressAgent("사당동 317-6", twin, manifest);
    expect(run.model).toEqual({
      provider: "local-rule-agent",
      name: "deterministic-preview-agent",
      available: true
    });
  });
});
