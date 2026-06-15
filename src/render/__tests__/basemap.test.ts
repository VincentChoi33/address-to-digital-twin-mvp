import { describe, expect, it } from "vitest";
import type { BasemapMosaic } from "../basemap";
import { worldToMosaicPixel, worldToMosaicUv } from "../../scene/terrain";

const mosaic = {
  canvas: { width: 100, height: 100 } as HTMLCanvasElement,
  pxPerMeter: 2,
  centerPx: 50,
  centerPy: 50,
  zoom: 19
} satisfies BasemapMosaic;

describe("basemap local-meter orientation", () => {
  it("maps east to increasing image x and north to decreasing image y", () => {
    expect(worldToMosaicPixel(mosaic, 10, 0)).toEqual({ px: 70, py: 50 });
    expect(worldToMosaicPixel(mosaic, 0, 10)).toEqual({ px: 50, py: 30 });
  });

  it("maps local north to a larger Three.js v coordinate for CanvasTexture", () => {
    const center = worldToMosaicUv(mosaic, 0, 0);
    const north = worldToMosaicUv(mosaic, 0, 10);
    const south = worldToMosaicUv(mosaic, 0, -10);
    expect(north.v).toBeGreaterThan(center.v);
    expect(south.v).toBeLessThan(center.v);
  });
});
