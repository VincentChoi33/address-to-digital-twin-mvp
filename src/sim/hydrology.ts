import type { LocalPoint, RoadHint, TwinProject } from "../types/twin";

// Pure, deterministic urban-flood toy model on a cell grid derived from a
// TwinProject. No Three.js, no DOM, no randomness — same twin in, same grid
// out, so the engine is unit-testable and replayable.
//
// This is a stylized demo (gravity routing + bucket sewers), not SWMM:
// rainfall is amplified so a cloudburst floods the board in seconds.

export const GRID_SIZE = 24;
export const CELL_SIZE_M = 6;
export const BOARD_HALF_M = (GRID_SIZE * CELL_SIZE_M) / 2; // 72m
export const CELL_AREA_M2 = CELL_SIZE_M * CELL_SIZE_M;

export const BASE_PIPE_CAPACITY_M = 0.6;
export const BASE_OUTFALL_RATE = 0.35; // m of pipe water the outfall discharges per second (the bottleneck)
const RAIN_DEMO_AMPLIFIER = 1000; // 시연용 가속: mm/h를 초 단위 체감 수위로 증폭
const SURFACE_FLOW_RATE = 3.2; // per-second head equalization factor
const SEWER_INTAKE_MPS = 0.09; // m of water a sewer inlet swallows per second
const ENTRANCE_LEAK_MPS = 0.12;
const ENTRANCE_LEAK_THRESHOLD_M = 0.03;
export const UNDERGROUND_ALARM_M3 = 15;

export type SimTool =
  | "inspect"
  | "road"
  | "building"
  | "sewer"
  | "pipe"
  | "outfall"
  | "raise"
  | "lower"
  | "eraser";

export type SimScenario = "normal" | "cloudburst" | "expanded_sewer" | "deep_tunnel";

export interface SimCell {
  x: number;
  z: number;
  type: "grass" | "road" | "building";
  elevation: number;
  buildingHeight: number;
  isTarget: boolean;
  name: string;
  hasSewer: boolean;
  hasPipe: boolean;
  hasOutfall: boolean;
  isUndergroundEntrance: boolean;
  water: number;
  pipeWater: number;
  overflowing: boolean;
}

export interface SimStats {
  surfaceWaterM3: number;
  pipeWaterM3: number;
  undergroundWaterM3: number;
  outflowM3: number;
  overflowCount: number;
  drainEfficiencyPct: number;
  pipePressurePct: number;
  dischargeSpeedMs: number;
}

export interface SimState {
  projectId: string;
  cells: SimCell[][];
  rainIntensity: number; // mm/h
  scenario: SimScenario;
  elapsedMs: number;
  pipeCapacity: number;
  outfallRate: number;
  undergroundWaterM3: number;
  outflowM3: number;
  lastTickOutflowM3: number;
  stats: SimStats;
}

function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ (x * 374761393) ^ (z * 668265263)) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 0xffffffff;
}

function seedFromString(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash || 1;
}

function cellCenter(index: number): number {
  return (index + 0.5) * CELL_SIZE_M - BOARD_HALF_M;
}

function pointInPolygon(px: number, pz: number, polygon: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, pz: number, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lengthSq));
  const cx = a.x + t * dx;
  const cz = a.z + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

function nearRoad(px: number, pz: number, roads: RoadHint[]): boolean {
  for (const road of roads) {
    const halfWidth = Math.max(road.width_m / 2, 2.4) + 1.2;
    for (let i = 0; i + 1 < road.centerline.length; i++) {
      if (distanceToSegment(px, pz, road.centerline[i], road.centerline[i + 1]) <= halfWidth) {
        return true;
      }
    }
  }
  return false;
}

function defaultCell(x: number, z: number): SimCell {
  return {
    x,
    z,
    type: "grass",
    elevation: 0.6,
    buildingHeight: 0,
    isTarget: false,
    name: "",
    hasSewer: false,
    hasPipe: false,
    hasOutfall: false,
    isUndergroundEntrance: false,
    water: 0,
    pipeWater: 0,
    overflowing: false
  };
}

function emptyStats(): SimStats {
  return {
    surfaceWaterM3: 0,
    pipeWaterM3: 0,
    undergroundWaterM3: 0,
    outflowM3: 0,
    overflowCount: 0,
    drainEfficiencyPct: 0,
    pipePressurePct: 0,
    dischargeSpeedMs: 0
  };
}

/** Rasterize a twin's buildings/roads into the simulation grid. */
export function createSimFromTwin(twin: TwinProject): SimState {
  const seed = seedFromString(twin.project_id);
  const slopeAngle = hash2(seed, 7, 13) * Math.PI * 2;
  const slopeX = Math.cos(slopeAngle);
  const slopeZ = Math.sin(slopeAngle);

  const cells: SimCell[][] = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    cells[x] = [];
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = defaultCell(x, z);
      const px = cellCenter(x);
      const pz = cellCenter(z);
      const downhill = ((px * slopeX + pz * slopeZ) / BOARD_HALF_M) * 0.45;
      cell.elevation = 0.8 + downhill + (hash2(seed, x, z) - 0.5) * 0.3;

      if (nearRoad(px, pz, twin.roads)) {
        cell.type = "road";
        cell.elevation -= 0.12;
        cell.hasPipe = true;
        const roadName = twin.roads[0]?.name ?? "도로";
        cell.name = roadName;
      }

      for (const building of twin.buildings) {
        if (pointInPolygon(px, pz, building.footprint)) {
          cell.type = "building";
          cell.buildingHeight = building.height_m;
          cell.isTarget = building.role === "target";
          cell.name = building.name;
          cell.hasPipe = false;
          cell.hasSewer = false;
          break;
        }
      }

      cells[x][z] = cell;
    }
  }

  // Guarantee a drainable road spine even if rasterization missed every hint.
  const hasRoad = cells.some((column) => column.some((cell) => cell.type === "road"));
  if (!hasRoad) {
    const row = Math.floor(GRID_SIZE / 2);
    for (let x = 0; x < GRID_SIZE; x++) {
      if (cells[x][row].type !== "building") {
        cells[x][row].type = "road";
        cells[x][row].hasPipe = true;
        cells[x][row].elevation -= 0.12;
      }
    }
  }

  // Sewer inlets on every third road cell.
  const roadCells: SimCell[] = [];
  for (const column of cells) {
    for (const cell of column) {
      if (cell.type === "road") roadCells.push(cell);
    }
  }
  roadCells.forEach((cell, index) => {
    if (index % 3 === 0) cell.hasSewer = true;
  });

  // Outfall at the lowest road cell touching the board edge (fallback: lowest road cell).
  const edgeRoads = roadCells.filter(
    (cell) => cell.x === 0 || cell.z === 0 || cell.x === GRID_SIZE - 1 || cell.z === GRID_SIZE - 1
  );
  const outfallPool = edgeRoads.length > 0 ? edgeRoads : roadCells;
  const outfall = outfallPool.reduce((lowest, cell) => (cell.elevation < lowest.elevation ? cell : lowest));
  outfall.hasOutfall = true;
  outfall.hasSewer = true;

  // Two underground-space entrances (지하철/지하상가 입구) on road cells nearest the target.
  const target = { x: GRID_SIZE / 2 - 0.5, z: GRID_SIZE / 2 - 0.5 };
  const byTargetDistance = [...roadCells].sort(
    (a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z)
  );
  byTargetDistance.slice(0, 2).forEach((cell) => {
    cell.isUndergroundEntrance = true;
  });

  return {
    projectId: twin.project_id,
    cells,
    rainIntensity: 0,
    scenario: "normal",
    elapsedMs: 0,
    pipeCapacity: BASE_PIPE_CAPACITY_M,
    outfallRate: BASE_OUTFALL_RATE,
    undergroundWaterM3: 0,
    outflowM3: 0,
    lastTickOutflowM3: 0,
    stats: emptyStats()
  };
}

function neighbors(state: SimState, x: number, z: number): SimCell[] {
  const result: SimCell[] = [];
  if (x > 0) result.push(state.cells[x - 1][z]);
  if (x < GRID_SIZE - 1) result.push(state.cells[x + 1][z]);
  if (z > 0) result.push(state.cells[x][z - 1]);
  if (z < GRID_SIZE - 1) result.push(state.cells[x][z + 1]);
  return result;
}

/** Advance the simulation by dtMs. Mutates and returns state. */
export function stepSim(state: SimState, dtMs: number): SimState {
  const dt = Math.min(dtMs, 100) / 1000;
  state.elapsedMs += dtMs;

  const rainPerSecond = (state.rainIntensity / 1000 / 3600) * RAIN_DEMO_AMPLIFIER;
  const rainfall = rainPerSecond * dt;

  // 1. Rainfall lands everywhere; building cells shed to their lowest open neighbor.
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = state.cells[x][z];
      if (cell.type !== "building") {
        cell.water += rainfall;
        continue;
      }
      const open = neighbors(state, x, z).filter((n) => n.type !== "building");
      if (open.length === 0) continue;
      const lowest = open.reduce((a, b) => (a.elevation + a.water < b.elevation + b.water ? a : b));
      lowest.water += rainfall;
    }
  }

  // 2. Surface gravity routing: equalize head with each lower neighbor.
  const flowFactor = Math.min(0.45, SURFACE_FLOW_RATE * dt);
  const deltas: number[][] = Array.from({ length: GRID_SIZE }, () => new Array<number>(GRID_SIZE).fill(0));
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = state.cells[x][z];
      if (cell.type === "building" || cell.water <= 0.0005) continue;
      const head = cell.elevation + cell.water;
      for (const neighbor of neighbors(state, x, z)) {
        if (neighbor.type === "building") continue;
        const neighborHead = neighbor.elevation + neighbor.water;
        if (head <= neighborHead) continue;
        const transfer = Math.min(cell.water * 0.5, ((head - neighborHead) / 2) * flowFactor);
        deltas[x][z] -= transfer;
        deltas[neighbor.x][neighbor.z] += transfer;
      }
    }
  }
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      state.cells[x][z].water = Math.max(0, state.cells[x][z].water + deltas[x][z]);
    }
  }

  // 3. Sewer intake / manhole backflow, underground leakage, outfall discharge.
  let outflowThisTick = 0;
  let saturatedSewers = 0;
  let sewerCount = 0;
  let overflowCount = 0;
  let pipeFillSum = 0;
  let pipeCellCount = 0;

  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = state.cells[x][z];
      cell.overflowing = false;

      if (cell.hasSewer) {
        sewerCount += 1;
        const intake = Math.min(cell.water, SEWER_INTAKE_MPS * dt);
        const available = state.pipeCapacity - cell.pipeWater;
        const absorbed = Math.max(0, Math.min(intake, available));
        cell.water -= absorbed;
        cell.pipeWater += absorbed;
        if (available <= 0.0001) {
          saturatedSewers += 1;
          if (cell.water > 0.02) {
            cell.overflowing = true;
            overflowCount += 1;
          }
        }
      }

      if (cell.isUndergroundEntrance && cell.water > ENTRANCE_LEAK_THRESHOLD_M) {
        const leak = Math.min(cell.water, ENTRANCE_LEAK_MPS * dt);
        cell.water -= leak;
        state.undergroundWaterM3 += leak * CELL_AREA_M2;
      }

      if (cell.hasPipe) {
        pipeCellCount += 1;
        pipeFillSum += cell.pipeWater / state.pipeCapacity;
        if (cell.hasOutfall && cell.pipeWater > 0) {
          const discharged = Math.min(cell.pipeWater, state.outfallRate * dt);
          cell.pipeWater -= discharged;
          outflowThisTick += discharged * CELL_AREA_M2;
        }
      }
    }
  }

  // 4. Pipe water migrates toward the outfall (uniform relaxation toward the drain).
  const pipeCells: SimCell[] = [];
  for (const column of state.cells) {
    for (const cell of column) if (cell.hasPipe) pipeCells.push(cell);
  }
  const outfallCell = pipeCells.find((cell) => cell.hasOutfall);
  if (outfallCell) {
    const migration = Math.min(0.6, state.outfallRate * dt * 4);
    for (const cell of pipeCells) {
      if (cell === outfallCell || cell.pipeWater <= 0) continue;
      const moved = cell.pipeWater * migration;
      const room = Math.max(0, state.pipeCapacity * 1.5 - outfallCell.pipeWater);
      const accepted = Math.min(moved, room);
      cell.pipeWater -= accepted;
      outfallCell.pipeWater += accepted;
    }
  }

  state.outflowM3 += outflowThisTick;
  state.lastTickOutflowM3 = outflowThisTick;

  // 5. Stats.
  let surface = 0;
  let pipe = 0;
  for (const column of state.cells) {
    for (const cell of column) {
      surface += cell.water * CELL_AREA_M2;
      pipe += cell.pipeWater * CELL_AREA_M2;
    }
  }
  state.stats = {
    surfaceWaterM3: surface,
    pipeWaterM3: pipe,
    undergroundWaterM3: state.undergroundWaterM3,
    outflowM3: state.outflowM3,
    overflowCount,
    drainEfficiencyPct: sewerCount === 0 ? 0 : Math.round(((sewerCount - saturatedSewers) / sewerCount) * 100),
    pipePressurePct: pipeCellCount === 0 ? 0 : Math.round((pipeFillSum / pipeCellCount) * 100),
    dischargeSpeedMs: dt === 0 ? 0 : Math.min(9.9, outflowThisTick / dt / 10)
  };
  return state;
}

/** Zero all water without touching terrain, infra, or cumulative outflow. */
export function dryUp(state: SimState): SimState {
  for (const column of state.cells) {
    for (const cell of column) {
      cell.water = 0;
      cell.pipeWater = 0;
      cell.overflowing = false;
    }
  }
  state.undergroundWaterM3 = 0;
  state.lastTickOutflowM3 = 0;
  state.stats = { ...emptyStats(), outflowM3: state.outflowM3 };
  return state;
}

export interface ScenarioInfo {
  id: SimScenario;
  label: string;
  description: string;
}

export const SCENARIOS: ScenarioInfo[] = [
  { id: "normal", label: "기본 (Clear)", description: "강우 0, 지표 건조" },
  { id: "cloudburst", label: "극한폭우 (140mm/h)", description: "2022 강남형 집중호우" },
  { id: "expanded_sewer", label: "하수도 2배 확장", description: "관거 용량 2배 + 빗물받이 전수 설치" },
  { id: "deep_tunnel", label: "대심도 배수터널", description: "방류 능력 4배" }
];

export function applyScenario(state: SimState, scenario: SimScenario): SimState {
  state.scenario = scenario;
  state.pipeCapacity = BASE_PIPE_CAPACITY_M;
  state.outfallRate = BASE_OUTFALL_RATE;

  if (scenario === "normal") {
    state.rainIntensity = 0;
    dryUp(state);
    return state;
  }
  if (scenario === "cloudburst") {
    state.rainIntensity = 140;
    return state;
  }
  if (scenario === "expanded_sewer") {
    state.rainIntensity = Math.max(state.rainIntensity, 140);
    state.pipeCapacity = BASE_PIPE_CAPACITY_M * 2;
    for (const column of state.cells) {
      for (const cell of column) {
        if (cell.type === "road") cell.hasSewer = true;
      }
    }
    return state;
  }
  state.rainIntensity = Math.max(state.rainIntensity, 140);
  state.outfallRate = BASE_OUTFALL_RATE * 4;
  return state;
}

/** Apply a city-editor tool to a cell. Returns the cell when it changed. */
export function applyTool(state: SimState, x: number, z: number, tool: SimTool): SimCell | null {
  if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) return null;
  const cell = state.cells[x][z];

  switch (tool) {
    case "inspect":
      return cell;
    case "road":
      cell.type = "road";
      cell.buildingHeight = 0;
      cell.isTarget = false;
      cell.hasPipe = true;
      return cell;
    case "building":
      cell.type = "building";
      cell.buildingHeight = 12 + ((x * 7 + z * 13) % 18);
      cell.water = 0;
      cell.hasSewer = false;
      cell.hasPipe = false;
      cell.hasOutfall = false;
      return cell;
    case "sewer":
      if (cell.type === "building") return null;
      cell.hasSewer = true;
      cell.hasPipe = true;
      return cell;
    case "pipe":
      if (cell.type === "building") return null;
      cell.hasPipe = true;
      return cell;
    case "outfall":
      if (cell.type === "building") return null;
      cell.hasOutfall = true;
      cell.hasPipe = true;
      cell.hasSewer = true;
      return cell;
    case "raise":
      cell.elevation = Math.min(3, cell.elevation + 0.3);
      return cell;
    case "lower":
      cell.elevation = Math.max(-0.5, cell.elevation - 0.3);
      return cell;
    case "eraser": {
      const fresh = defaultCell(x, z);
      fresh.elevation = cell.elevation;
      state.cells[x][z] = fresh;
      return fresh;
    }
    default:
      return null;
  }
}
