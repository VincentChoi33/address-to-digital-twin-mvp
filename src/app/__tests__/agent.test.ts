import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import { runLocalAddressAgent } from "../agent";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;

describe("runLocalAddressAgent", () => {
  it("matches the Sadang sample by parcel number and loads the curated twin", () => {
    const run = runLocalAddressAgent("사당동 317-6번지 디지털 트윈 만들어줘", twin, manifest);
    expect(run.twin).toBe(twin);
    expect(run.manifest).toBe(manifest);
    expect(run.recognizedAddress).toContain(twin.addresses.parcel_address);
  });

  it("matches the Sadang sample by road address and building name", () => {
    for (const query of ["사당로20가길 39 트윈", "행복이가득한집 보여줘"]) {
      const run = runLocalAddressAgent(query, twin, manifest);
      expect(run.twin, query).toBe(twin);
    }
  });

  it("generates a fresh offline preview twin for out-of-sample addresses", () => {
    const run = runLocalAddressAgent("서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘", twin, manifest);
    expect(run.twin).toBeDefined();
    expect(run.twin).not.toBe(twin);
    expect(run.manifest).toBeDefined();
    expect(run.confidence).toBe("low");
    expect(run.twin?.addresses.parcel_address).toContain("테헤란로 152");
    expect(run.twin?.buildings.some((building) => building.role === "target")).toBe(true);
  });

  it("out-of-sample twins are deterministic per address and distinct across addresses", () => {
    const a = runLocalAddressAgent("부산 해운대구 우동 1408", twin, manifest);
    const b = runLocalAddressAgent("부산 해운대구 우동 1408", twin, manifest);
    const c = runLocalAddressAgent("대전 유성구 대학로 99", twin, manifest);
    expect(a.twin?.center).toEqual(b.twin?.center);
    expect(a.twin?.center).not.toEqual(c.twin?.center);
  });

  it("detects official-data intent from precision keywords", () => {
    expect(runLocalAddressAgent("사당동 317-6 공식 디지털 트윈", twin, manifest).intent).toBe("official_required");
    expect(runLocalAddressAgent("사당동 317-6 측량 결과 필요", twin, manifest).intent).toBe("official_required");
    expect(runLocalAddressAgent("사당동 317-6 프리뷰", twin, manifest).intent).toBe("preview");
  });

  it("falls back to the default Sadang prompt for empty queries", () => {
    const run = runLocalAddressAgent("   ", twin, manifest);
    expect(run.query).toBe("사당동 317-6번지 디지털 트윈 만들어줘");
    expect(run.twin).toBe(twin);
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
