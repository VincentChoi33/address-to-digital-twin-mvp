import * as THREE from "three";
import type { BasemapMosaic } from "../render/basemap";
import type { Coordinate } from "../types/twin";

// Real elevation from AWS Terrain Tiles (terrarium encoding, public S3, no key).
// h(m) = R*256 + G + B/256 - 32768

export const DOMAIN_SIZE_M = 440; // simulation/scene domain edge length
export const HEIGHT_GRID = 257; // terrain mesh corners per edge (256 quads)

const EARTH_CIRCUMFERENCE_M = 40075016.686;

export interface Heightfield {
  /** ground elevation in meters, row-major [z][x], normalized so min≈0 */
  data: Float32Array;
  size: number;
  cellM: number;
  minElevation: number;
  maxElevation: number;
}

function loadImage(url: string, timeoutMs = 4500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timeout = window.setTimeout(() => {
      image.src = "";
      finish(null);
    }, timeoutMs);
    image.crossOrigin = "anonymous";
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Fetch a terrarium DEM mosaic around the center and resample it onto the
 * HEIGHT_GRID over the local domain. Falls back to a flat field offline.
 */
export async function loadHeightfield(center: Coordinate): Promise<Heightfield> {
  const zoom = 15;
  const n = 2 ** zoom;
  const latRad = (center.lat * Math.PI) / 180;
  const xFloat = ((center.lon + 180) / 360) * n;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tileMeters = (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / n;
  const span = DOMAIN_SIZE_M / 2 / tileMeters + 0.05;

  const minX = Math.floor(xFloat - span);
  const maxX = Math.floor(xFloat + span);
  const minY = Math.floor(yFloat - span);
  const maxY = Math.floor(yFloat + span);

  const canvas = document.createElement("canvas");
  canvas.width = (maxX - minX + 1) * 256;
  canvas.height = (maxY - minY + 1) * 256;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const flat = (): Heightfield => ({
    data: new Float32Array(HEIGHT_GRID * HEIGHT_GRID),
    size: HEIGHT_GRID,
    cellM: DOMAIN_SIZE_M / (HEIGHT_GRID - 1),
    minElevation: 0,
    maxElevation: 0
  });
  if (!context) return flat();

  const loads: Array<Promise<boolean>> = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      loads.push(
        loadImage(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`).then((img) => {
          if (!img) return false;
          context.drawImage(img, (tx - minX) * 256, (ty - minY) * 256);
          return true;
        })
      );
    }
  }
  const ok = (await Promise.all(loads)).filter(Boolean).length;
  if (ok === 0) return flat();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const pxPerMeter = 256 / tileMeters;
  const centerPx = (xFloat - minX) * 256;
  const centerPy = (yFloat - minY) * 256;

  const sample = (px: number, py: number): number => {
    const cx = Math.min(canvas.width - 1, Math.max(0, px));
    const cy = Math.min(canvas.height - 1, Math.max(0, py));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(canvas.width - 1, x0 + 1);
    const y1 = Math.min(canvas.height - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const at = (x: number, y: number) => {
      const o = (y * canvas.width + x) * 4;
      return decodeTerrarium(pixels.data[o], pixels.data[o + 1], pixels.data[o + 2]);
    };
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy;
  };

  const data = new Float32Array(HEIGHT_GRID * HEIGHT_GRID);
  for (let row = 0; row < HEIGHT_GRID; row++) {
    for (let col = 0; col < HEIGHT_GRID; col++) {
      const worldX = (col / (HEIGHT_GRID - 1) - 0.5) * DOMAIN_SIZE_M;
      const worldZ = (row / (HEIGHT_GRID - 1) - 0.5) * DOMAIN_SIZE_M;
      // local +z = north → image y decreases northward.
      // Terrarium is topobathy: the sea floor comes back as -180m off Busan
      // and would hijack the min-normalization — clamp water to sea level.
      data[row * HEIGHT_GRID + col] = Math.max(
        sample(centerPx + worldX * pxPerMeter, centerPy - worldZ * pxPerMeter),
        -2
      );
    }
  }

  // Terrarium's Korea source (ALOS) is a DSM — towers ride along as 100m
  // "hills". Approximate a DTM: morphological erosion pulls every window down
  // to street level (streets are true ground between buildings), then a blur
  // removes the resulting terraces. Only the topographic trend should drive
  // flood routing; the real buildings are added back as solver obstacles.
  erodeToGround(data, HEIGHT_GRID, 24);
  smoothHeights(data, HEIGHT_GRID, 10, 2);

  let min = Infinity;
  let max = -Infinity;
  for (const h of data) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  for (let i = 0; i < data.length; i++) data[i] -= min;
  return {
    data,
    size: HEIGHT_GRID,
    cellM: DOMAIN_SIZE_M / (HEIGHT_GRID - 1),
    minElevation: min,
    maxElevation: max - min
  };
}

/** Separable morphological erosion (local minimum) — DSM → pseudo-DTM. */
export function erodeToGround(data: Float32Array, size: number, radius: number): void {
  const temp = new Float32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let lowest = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const c = col + k;
        if (c < 0 || c >= size) continue;
        const value = data[row * size + c];
        if (value < lowest) lowest = value;
      }
      temp[row * size + col] = lowest;
    }
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let lowest = Infinity;
      for (let k = -radius; k <= radius; k++) {
        const r = row + k;
        if (r < 0 || r >= size) continue;
        const value = temp[r * size + col];
        if (value < lowest) lowest = value;
      }
      data[row * size + col] = lowest;
    }
  }
}

/** Separable box blur, `passes`× — approximates a wide gaussian. */
export function smoothHeights(data: Float32Array, size: number, radius: number, passes: number): void {
  const temp = new Float32Array(size * size);
  for (let pass = 0; pass < passes; pass++) {
    // horizontal
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const c = col + k;
          if (c < 0 || c >= size) continue;
          sum += data[row * size + c];
          count++;
        }
        temp[row * size + col] = sum / count;
      }
    }
    // vertical
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const r = row + k;
          if (r < 0 || r >= size) continue;
          sum += temp[r * size + col];
          count++;
        }
        data[row * size + col] = sum / count;
      }
    }
  }
}

export function heightAt(field: Heightfield, worldX: number, worldZ: number): number {
  const grid = field.size - 1;
  const fx = ((worldX / DOMAIN_SIZE_M + 0.5) * grid + 0) || 0;
  const fz = ((worldZ / DOMAIN_SIZE_M + 0.5) * grid + 0) || 0;
  const x0 = Math.min(grid - 1, Math.max(0, Math.floor(fx)));
  const z0 = Math.min(grid - 1, Math.max(0, Math.floor(fz)));
  const dx = Math.min(1, Math.max(0, fx - x0));
  const dz = Math.min(1, Math.max(0, fz - z0));
  const at = (x: number, z: number) => field.data[z * field.size + x];
  return (
    at(x0, z0) * (1 - dx) * (1 - dz) +
    at(x0 + 1, z0) * dx * (1 - dz) +
    at(x0, z0 + 1) * (1 - dx) * dz +
    at(x0 + 1, z0 + 1) * dx * dz
  );
}

/** Terrain mesh: real DEM relief with the satellite mosaic draped at full resolution. */
export function buildTerrainMesh(field: Heightfield, mosaic: BasemapMosaic | null, maxAnisotropy = 8): THREE.Mesh {
  const grid = field.size - 1;
  const geometry = new THREE.PlaneGeometry(DOMAIN_SIZE_M, DOMAIN_SIZE_M, grid, grid);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const uvs = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const worldX = positions.getX(i);
    const worldZ = positions.getZ(i);
    positions.setY(i, heightAt(field, worldX, worldZ));
    if (mosaic) {
      // map each vertex to its exact mosaic pixel (+z = north = image up)
      const px = mosaic.centerPx + worldX * mosaic.pxPerMeter;
      const py = mosaic.centerPy - worldZ * mosaic.pxPerMeter;
      uvs.setXY(i, px / mosaic.canvas.width, 1 - py / mosaic.canvas.height);
    }
  }
  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.computeVertexNormals();

  let material: THREE.MeshStandardMaterial;
  if (mosaic) {
    const texture = new THREE.CanvasTexture(mosaic.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.96, metalness: 0 });
  } else {
    material = new THREE.MeshStandardMaterial({ color: 0x2b3a32, roughness: 1 });
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
