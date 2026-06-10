import { describe, expect, it } from "vitest";
import { buildPreviewTwin } from "../../core/previewTwin";
import {
  GRID_SIZE,
  applyScenario,
  applyTool,
  createSimFromTwin,
  dryUp,
  stepSim
} from "../hydrology";

function makeSim(query = "서울 강남구 테헤란로 152") {
  const { twin } = buildPreviewTwin(query);
  return createSimFromTwin(twin);
}

function flatCells(sim: ReturnType<typeof makeSim>) {
  return sim.cells.flat();
}

describe("createSimFromTwin", () => {
  it("rasterizes the twin into a full grid with roads, buildings, and a target", () => {
    const sim = makeSim();
    const cells = flatCells(sim);
    expect(cells.length).toBe(GRID_SIZE * GRID_SIZE);
    expect(cells.some((cell) => cell.type === "road")).toBe(true);
    expect(cells.some((cell) => cell.type === "building")).toBe(true);
    expect(cells.some((cell) => cell.isTarget)).toBe(true);
  });

  it("always places drainage infrastructure: sewers, exactly accessible outfall, entrances", () => {
    const sim = makeSim();
    const cells = flatCells(sim);
    expect(cells.filter((cell) => cell.hasSewer).length).toBeGreaterThan(0);
    expect(cells.filter((cell) => cell.hasOutfall).length).toBe(1);
    expect(cells.filter((cell) => cell.isUndergroundEntrance).length).toBe(2);
  });

  it("is deterministic: same twin → identical grid", () => {
    const a = makeSim("서울 마포구 성산동 250-1");
    const b = makeSim("서울 마포구 성산동 250-1");
    expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
  });

  it("different addresses produce different terrain", () => {
    const a = makeSim("서울 마포구 성산동 250-1");
    const b = makeSim("부산 해운대구 우동 1408");
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(b.cells));
  });
});

describe("stepSim", () => {
  it("no rain → board stays dry", () => {
    const sim = makeSim();
    for (let i = 0; i < 20; i++) stepSim(sim, 50);
    expect(sim.stats.surfaceWaterM3).toBe(0);
    expect(sim.stats.overflowCount).toBe(0);
  });

  it("cloudburst rain accumulates surface water and fills pipes", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    for (let i = 0; i < 100; i++) stepSim(sim, 50); // 5 simulated seconds
    expect(sim.stats.surfaceWaterM3).toBeGreaterThan(100);
    expect(sim.stats.pipeWaterM3).toBeGreaterThan(0);
    expect(sim.stats.pipePressurePct).toBeGreaterThan(0);
  });

  it("water flows downhill toward lower head", () => {
    const sim = makeSim();
    const cell = sim.cells[10][10];
    const neighbor = sim.cells[11][10];
    cell.type = "grass";
    neighbor.type = "grass";
    cell.elevation = 1.0;
    neighbor.elevation = 0.2;
    cell.water = 0.5;
    stepSim(sim, 50);
    expect(sim.cells[11][10].water).toBeGreaterThan(0);
    expect(sim.cells[10][10].water).toBeLessThan(0.5);
  });

  it("outfall discharges pipe water into cumulative outflow", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    for (let i = 0; i < 200; i++) stepSim(sim, 50); // 10 simulated seconds
    expect(sim.outflowM3).toBeGreaterThan(0);
    expect(sim.stats.outflowM3).toBe(sim.outflowM3);
  });

  it("sustained cloudburst eventually backs up manholes", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    let sawOverflow = false;
    for (let i = 0; i < 600; i++) {
      stepSim(sim, 50);
      if (sim.stats.overflowCount > 0) {
        sawOverflow = true;
        break;
      }
    }
    expect(sawOverflow).toBe(true);
  });

  it("underground entrances leak street water into the underground volume", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    for (let i = 0; i < 300; i++) stepSim(sim, 50);
    expect(sim.undergroundWaterM3).toBeGreaterThan(0);
  });

  it("expanded sewer scenario floods less than the baseline cloudburst", () => {
    const base = makeSim("서울 중구 세종대로 110");
    applyScenario(base, "cloudburst");
    const upgraded = makeSim("서울 중구 세종대로 110");
    applyScenario(upgraded, "expanded_sewer");
    for (let i = 0; i < 300; i++) {
      stepSim(base, 50);
      stepSim(upgraded, 50);
    }
    expect(upgraded.stats.surfaceWaterM3).toBeLessThan(base.stats.surfaceWaterM3);
  });
});

describe("dryUp / scenarios", () => {
  it("dryUp zeroes all water but keeps terrain and cumulative outflow", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    for (let i = 0; i < 100; i++) stepSim(sim, 50);
    const outflowBefore = sim.outflowM3;
    const elevationBefore = sim.cells[5][5].elevation;
    dryUp(sim);
    expect(flatCells(sim).every((cell) => cell.water === 0 && cell.pipeWater === 0)).toBe(true);
    expect(sim.undergroundWaterM3).toBe(0);
    expect(sim.outflowM3).toBe(outflowBefore);
    expect(sim.cells[5][5].elevation).toBe(elevationBefore);
  });

  it("normal scenario stops the rain and dries the board", () => {
    const sim = makeSim();
    applyScenario(sim, "cloudburst");
    for (let i = 0; i < 50; i++) stepSim(sim, 50);
    applyScenario(sim, "normal");
    expect(sim.rainIntensity).toBe(0);
    expect(sim.stats.surfaceWaterM3).toBe(0);
  });
});

describe("applyTool", () => {
  it("paves roads, builds buildings, and erases back to grass", () => {
    const sim = makeSim();
    expect(applyTool(sim, 3, 3, "road")?.type).toBe("road");
    expect(applyTool(sim, 4, 4, "building")?.type).toBe("building");
    expect(applyTool(sim, 4, 4, "eraser")?.type).toBe("grass");
  });

  it("refuses underground infra on building cells", () => {
    const sim = makeSim();
    applyTool(sim, 6, 6, "building");
    expect(applyTool(sim, 6, 6, "sewer")).toBeNull();
    expect(applyTool(sim, 6, 6, "outfall")).toBeNull();
  });

  it("raise/lower clamp elevation", () => {
    const sim = makeSim();
    for (let i = 0; i < 30; i++) applyTool(sim, 2, 2, "raise");
    expect(sim.cells[2][2].elevation).toBe(3);
    for (let i = 0; i < 30; i++) applyTool(sim, 2, 2, "lower");
    expect(sim.cells[2][2].elevation).toBe(-0.5);
  });

  it("rejects out-of-bounds coordinates", () => {
    const sim = makeSim();
    expect(applyTool(sim, -1, 0, "road")).toBeNull();
    expect(applyTool(sim, 0, GRID_SIZE, "road")).toBeNull();
  });
});
