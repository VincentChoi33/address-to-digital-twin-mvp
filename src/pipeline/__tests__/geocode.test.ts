import { describe, expect, it } from "vitest";
import { normalizeAddressCandidates } from "../geocode";

describe("normalizeAddressCandidates", () => {
  it("expands the Sadang sample into parcel, road, and building-name candidates", () => {
    const candidates = normalizeAddressCandidates("사당동 317-6번지 디지털 트윈 만들어줘");
    const types = candidates.map((candidate) => candidate.type);
    expect(types).toContain("raw");
    expect(types).toContain("parcel");
    expect(types).toContain("road");
    expect(types).toContain("building_name");
  });

  it("strips request phrasing from the raw candidate", () => {
    const [raw] = normalizeAddressCandidates("서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘");
    expect(raw.type).toBe("raw");
    expect(raw.label).toBe("서울 강남구 테헤란로 152");
  });

  it("classifies road-style addresses as road candidates", () => {
    const candidates = normalizeAddressCandidates("서울 강남구 테헤란로 152");
    expect(candidates.some((candidate) => candidate.type === "road")).toBe(true);
  });

  it("classifies parcel-style addresses as parcel candidates", () => {
    const candidates = normalizeAddressCandidates("서울 마포구 성산동 250-1");
    expect(candidates.some((candidate) => candidate.type === "parcel")).toBe(true);
  });

  it("never returns an empty candidate list", () => {
    const candidates = normalizeAddressCandidates("");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].label.length).toBeGreaterThan(0);
  });
});
