import type { Coordinate } from "../types/twin";

export type BasemapMode = "procedural" | "vworld" | "arcgis" | "custom";

export function resolveBasemapMode(raw: string | undefined, customTileUrl?: string): BasemapMode {
  if (raw === "procedural" || raw === "vworld" || raw === "arcgis") return raw;
  if (raw === "custom") return customTileUrl ? "custom" : "procedural";
  return "arcgis";
}

function tileUrl(mode: BasemapMode, z: number, x: number, y: number, customTileUrl?: string): string {
  if (mode === "vworld") return `/api/vworld/wmts/Satellite/${z}/${y}/${x}.jpeg`;
  if (mode === "custom" && customTileUrl) {
    return customTileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  }
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export const BASEMAP_ATTRIBUTION: Record<BasemapMode, string> = {
  procedural: "오프라인 절차적 그리드 (외부 타일 없음)",
  arcgis: "Esri World Imagery (실시간 프리뷰, 캐시 없음)",
  vworld: "VWorld WMTS Satellite (서버 프록시, 캐시 없음)",
  custom: "커스텀 타일 (제공자 약관 확인 필요)"
};

export interface BasemapMosaic {
  canvas: HTMLCanvasElement;
  /** mosaic pixels per local meter at this latitude/zoom */
  pxPerMeter: number;
  /** mosaic pixel of the twin center (x to the right, y downward) */
  centerPx: number;
  centerPy: number;
}

/**
 * Build a 3x3 live tile mosaic around the center as one canvas, for draping
 * onto the simulation board. Returns null when offline/blocked — callers fall
 * back to the procedural ground. Nothing is cached or persisted.
 */
export async function loadBasemapMosaic(
  mode: BasemapMode,
  center: Coordinate,
  customTileUrl?: string
): Promise<BasemapMosaic | null> {
  if (mode === "procedural") return null;

  const zoom = 17;
  const n = 2 ** zoom;
  const xFloat = ((center.lon + 180) / 360) * n;
  const latRad = (center.lat * Math.PI) / 180;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const centerX = Math.floor(xFloat);
  const centerY = Math.floor(yFloat);

  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const loads: Array<Promise<{ image: HTMLImageElement | null; dx: number; dy: number }>> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      loads.push(
        loadImage(tileUrl(mode, zoom, centerX + dx, centerY + dy, customTileUrl)).then((image) => ({ image, dx, dy }))
      );
    }
  }
  const tiles = await Promise.all(loads);
  const loaded = tiles.filter((tile) => tile.image);
  if (loaded.length === 0) return null;

  context.fillStyle = "#1c2430";
  context.fillRect(0, 0, 768, 768);
  for (const tile of tiles) {
    if (tile.image) context.drawImage(tile.image, (tile.dx + 1) * 256, (tile.dy + 1) * 256, 256, 256);
  }

  const tileMeters = (40075016.686 * Math.cos(latRad)) / n;
  return {
    canvas,
    pxPerMeter: 256 / tileMeters,
    centerPx: (xFloat - (centerX - 1)) * 256,
    centerPy: (yFloat - (centerY - 1)) * 256
  };
}
