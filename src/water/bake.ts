import type { LocalPoint, TwinProject } from "../types/twin";
import { heightAt, type Heightfield } from "../scene/terrain";
import { SIM_N } from "./solver";

// CPU-side, fully deterministic bake of the solver's static inputs:
//  - solid height = real DEM + extruded building obstacles
//  - drain field  = storm inlets placed along real road centerlines

export interface DrainPoint {
  x: number;
  z: number;
}

export interface BakedDomain {
  solidHeight: Float32Array; // SIM_N*SIM_N, meters
  drainRate: Float32Array; // SIM_N*SIM_N, m/s intake
  /** 1 inside a building footprint — no direct rainfall, no water surface */
  buildingMask: Float32Array;
  drains: DrainPoint[];
  /** network capacity in m³ before manholes start backflowing */
  networkCapacityM3: number;
}

export const DRAIN_SPACING_M = 18;
export const DRAIN_RATE_MPS = 0.055;
export const CAPACITY_PER_DRAIN_M3 = 6;

function bbox(points: LocalPoint[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function pointInPolygon(px: number, pz: number, polygon: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Storm inlets every DRAIN_SPACING_M along each road centerline. */
export function placeDrains(twin: TwinProject, domainM: number): DrainPoint[] {
  const half = domainM / 2;
  const drains: DrainPoint[] = [];
  for (const road of twin.roads) {
    for (let i = 0; i + 1 < road.centerline.length; i++) {
      const a = road.centerline[i];
      const b = road.centerline[i + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.floor(length / DRAIN_SPACING_M));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4) continue;
        // skip near-duplicates where segments meet
        if (drains.some((d) => Math.hypot(d.x - x, d.z - z) < DRAIN_SPACING_M * 0.6)) continue;
        drains.push({ x, z });
      }
    }
  }
  return drains;
}

export function bakeDomain(twin: TwinProject, field: Heightfield, domainM: number): BakedDomain {
  const solidHeight = new Float32Array(SIM_N * SIM_N);
  const drainRate = new Float32Array(SIM_N * SIM_N);
  const buildingMask = new Float32Array(SIM_N * SIM_N);
  const cell = domainM / SIM_N;
  const half = domainM / 2;

  const polygons = twin.buildings
    .filter((building) => building.footprint.length >= 4)
    .map((building) => ({
      points: building.footprint,
      height: Math.max(3, building.height_m),
      box: bbox(building.footprint)
    }));

  for (let row = 0; row < SIM_N; row++) {
    const z = (row + 0.5) * cell - half;
    for (let col = 0; col < SIM_N; col++) {
      const x = (col + 0.5) * cell - half;
      let h = heightAt(field, x, z);
      for (const polygon of polygons) {
        if (
          x >= polygon.box.minX &&
          x <= polygon.box.maxX &&
          z >= polygon.box.minZ &&
          z <= polygon.box.maxZ &&
          pointInPolygon(x, z, polygon.points)
        ) {
          h += polygon.height;
          buildingMask[row * SIM_N + col] = 1;
          break;
        }
      }
      solidHeight[row * SIM_N + col] = h;
    }
  }

  const drains = placeDrains(twin, domainM);
  for (const drain of drains) {
    const col = Math.round((drain.x + half) / cell - 0.5);
    const row = Math.round((drain.z + half) / cell - 0.5);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = col + dx;
        const r = row + dz;
        if (c < 0 || r < 0 || c >= SIM_N || r >= SIM_N) continue;
        const weight = dx === 0 && dz === 0 ? 1 : 0.35;
        const index = r * SIM_N + c;
        drainRate[index] = Math.max(drainRate[index], DRAIN_RATE_MPS * weight);
      }
    }
  }

  return {
    solidHeight,
    drainRate,
    buildingMask,
    drains,
    networkCapacityM3: Math.max(60, drains.length * CAPACITY_PER_DRAIN_M3)
  };
}
