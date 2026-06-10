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
  zoom: number;
}

const EARTH_CIRCUMFERENCE_M = 40075016.686;

async function loadMosaicAtZoom(
  mode: BasemapMode,
  center: Coordinate,
  zoom: number,
  halfSpanM: number,
  customTileUrl?: string
): Promise<BasemapMosaic | null> {
  const n = 2 ** zoom;
  const latRad = (center.lat * Math.PI) / 180;
  const xFloat = ((center.lon + 180) / 360) * n;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tileMeters = (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / n;
  const tileSpan = halfSpanM / tileMeters;

  const minX = Math.floor(xFloat - tileSpan);
  const maxX = Math.floor(xFloat + tileSpan);
  const minY = Math.floor(yFloat - tileSpan);
  const maxY = Math.floor(yFloat + tileSpan);

  const canvas = document.createElement("canvas");
  canvas.width = (maxX - minX + 1) * 256;
  canvas.height = (maxY - minY + 1) * 256;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#1c2430";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const loads: Array<Promise<boolean>> = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      loads.push(
        loadImage(tileUrl(mode, zoom, tx, ty, customTileUrl)).then((image) => {
          if (!image) return false;
          context.drawImage(image, (tx - minX) * 256, (ty - minY) * 256, 256, 256);
          return true;
        })
      );
    }
  }
  const results = await Promise.all(loads);
  const loadedRatio = results.filter(Boolean).length / results.length;
  // High zooms are missing in some regions — caller falls back to a lower zoom.
  if (loadedRatio < 0.7) return null;

  return {
    canvas,
    pxPerMeter: 256 / tileMeters,
    centerPx: (xFloat - minX) * 256,
    centerPy: (yFloat - minY) * 256,
    zoom
  };
}

/**
 * Build a live tile mosaic covering ±halfSpanM around the center as one
 * canvas, draped onto the board as a full-resolution texture. Tries the
 * sharpest zoom first (z19 ≈ 0.24m/px) and degrades where unavailable.
 * Returns null when offline/blocked — callers fall back to the procedural
 * ground. Nothing is cached or persisted.
 */
export async function loadBasemapMosaic(
  mode: BasemapMode,
  center: Coordinate,
  customTileUrl?: string,
  halfSpanM = 90
): Promise<BasemapMosaic | null> {
  if (mode === "procedural") return null;
  for (const zoom of [19, 18, 17]) {
    const mosaic = await loadMosaicAtZoom(mode, center, zoom, halfSpanM, customTileUrl);
    if (mosaic) return mosaic;
  }
  return null;
}
