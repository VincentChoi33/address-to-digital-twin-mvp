import { describe, expect, it } from "vitest";
import { HEIGHT_GRID, decodeTerrarium, heightAt, type Heightfield } from "../terrain";

describe("decodeTerrarium", () => {
  it("decodes sea level and known elevations", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0); // 32768/256 = 128
    expect(decodeTerrarium(128, 100, 0)).toBe(100);
    expect(decodeTerrarium(127, 156, 0)).toBe(-100);
    expect(decodeTerrarium(128, 0, 128)).toBeCloseTo(0.5);
  });
});

describe("heightAt", () => {
  it("bilinearly interpolates and clamps at domain edges", () => {
    const data = new Float32Array(HEIGHT_GRID * HEIGHT_GRID);
    for (let row = 0; row < HEIGHT_GRID; row++) {
      for (let col = 0; col < HEIGHT_GRID; col++) {
        data[row * HEIGHT_GRID + col] = col; // ramp west→east
      }
    }
    const field: Heightfield = { data, size: HEIGHT_GRID, cellM: 440 / (HEIGHT_GRID - 1), minElevation: 0, maxElevation: HEIGHT_GRID - 1 };
    expect(heightAt(field, 0, 0)).toBeCloseTo((HEIGHT_GRID - 1) / 2, 0);
    expect(heightAt(field, -220, 0)).toBeCloseTo(0, 0);
    expect(heightAt(field, 220, 0)).toBeCloseTo(HEIGHT_GRID - 1, 0);
    expect(heightAt(field, -10000, 0)).toBeCloseTo(0, 0); // clamped
  });
});
