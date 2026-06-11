import { describe, expect, it } from "vitest";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import { buildPreviewTwin } from "../../core/previewTwin";
import { HEIGHT_GRID, type Heightfield } from "../../scene/terrain";
import type { TwinProject } from "../../types/twin";
import { CAPACITY_PER_DRAIN_M3, bakeDomain, placeDrains } from "../bake";
import { SIM_N } from "../solver";

const DOMAIN = 440;

function flatField(elevation = 5): Heightfield {
  const data = new Float32Array(HEIGHT_GRID * HEIGHT_GRID).fill(elevation);
  return {
    data,
    size: HEIGHT_GRID,
    cellM: DOMAIN / (HEIGHT_GRID - 1),
    minElevation: elevation,
    maxElevation: elevation
  };
}

const sadang = sadangTwin as unknown as TwinProject;

describe("placeDrains", () => {
  it("places storm inlets along every road, none outside the domain", () => {
    const drains = placeDrains(sadang, DOMAIN);
    expect(drains.length).toBeGreaterThan(3);
    for (const drain of drains) {
      expect(Math.abs(drain.x)).toBeLessThan(DOMAIN / 2);
      expect(Math.abs(drain.z)).toBeLessThan(DOMAIN / 2);
    }
  });

  it("deduplicates drains where road segments meet", () => {
    const drains = placeDrains(sadang, DOMAIN);
    for (let i = 0; i < drains.length; i++) {
      for (let j = i + 1; j < drains.length; j++) {
        const distance = Math.hypot(drains[i].x - drains[j].x, drains[i].z - drains[j].z);
        expect(distance).toBeGreaterThan(8);
      }
    }
  });
});

describe("bakeDomain", () => {
  it("raises solid height inside building footprints (obstacles for the solver)", () => {
    const field = flatField(5);
    const baked = bakeDomain(sadang, field, DOMAIN);
    const target = sadang.buildings.find((b) => b.role === "target")!;
    const cx = target.footprint.reduce((s, p) => s + p.x, 0) / target.footprint.length;
    const cz = target.footprint.reduce((s, p) => s + p.z, 0) / target.footprint.length;
    const col = Math.round((cx + DOMAIN / 2) / (DOMAIN / SIM_N) - 0.5);
    const row = Math.round((cz + DOMAIN / 2) / (DOMAIN / SIM_N) - 0.5);
    const inside = baked.solidHeight[row * SIM_N + col];
    const corner = baked.solidHeight[0];
    expect(inside).toBeGreaterThan(corner + 2);
  });

  it("bakes drain rates and a positive network capacity", () => {
    const baked = bakeDomain(sadang, flatField(), DOMAIN);
    const drainCells = Array.from(baked.drainRate).filter((rate) => rate > 0).length;
    expect(drainCells).toBeGreaterThan(baked.drains.length); // splat covers neighbours
    expect(baked.networkCapacityM3).toBeGreaterThanOrEqual(60);
    expect(baked.networkCapacityM3).toBeGreaterThanOrEqual(baked.drains.length * CAPACITY_PER_DRAIN_M3);
  });

  it("works for offline preview twins of arbitrary addresses", () => {
    const { twin } = buildPreviewTwin("부산 해운대구 우동 1408");
    const baked = bakeDomain(twin, flatField(), DOMAIN);
    expect(baked.drains.length).toBeGreaterThan(0);
    expect(Array.from(baked.solidHeight).some((h) => h > 6)).toBe(true);
  });
});
