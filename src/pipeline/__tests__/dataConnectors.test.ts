import { describe, expect, it } from "vitest";
import { lonLatToLocalMeters } from "../dataConnectors";

describe("lonLatToLocalMeters", () => {
  const center = { lat: 37.4842, lon: 126.96975 };

  it("maps the center itself to the local origin", () => {
    expect(lonLatToLocalMeters(center, center)).toEqual({ x: 0, z: 0 });
  });

  it("converts one degree of latitude to ~111.3 km north", () => {
    const point = lonLatToLocalMeters(center, { lat: center.lat + 1, lon: center.lon });
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.z).toBeCloseTo(111_320, 0);
  });

  it("scales longitude by the latitude cosine", () => {
    const point = lonLatToLocalMeters(center, { lat: center.lat, lon: center.lon + 1 });
    const expected = 111_320 * Math.cos((center.lat * Math.PI) / 180);
    expect(point.x).toBeCloseTo(expected, 0);
    expect(point.z).toBeCloseTo(0, 6);
  });

  it("returns negative offsets for points south-west of the center", () => {
    const point = lonLatToLocalMeters(center, { lat: center.lat - 0.001, lon: center.lon - 0.001 });
    expect(point.x).toBeLessThan(0);
    expect(point.z).toBeLessThan(0);
  });
});
