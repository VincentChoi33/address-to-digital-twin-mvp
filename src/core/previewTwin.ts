import type { SourceManifest, TwinProject } from "../types/twin";
import { fallbackResult, hashQuery } from "./address";
import { generateMassing } from "./generateMassing";
import { buildSourceManifest } from "./manifest";

export interface PreviewTwinResult {
  twin: TwinProject;
  manifest: SourceManifest;
}

export function projectIdFromQuery(rawQuery: string): string {
  // NFC, not NFKD: NFKD decomposes Hangul syllables into Jamo, which the
  // 가-힣 class no longer matches — Korean would vanish from the id.
  const safe = rawQuery
    .normalize("NFC")
    .replace(/디지털\s*트윈|만들어줘|만들어|프리뷰|preview|생성/gi, " ")
    .replace(/[^\w가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return safe || "address_twin_preview";
}

/**
 * Browser-safe, fully offline twin generation: deterministic fallback
 * coordinates + procedural massing. No API keys, no network. The Node
 * pipeline (runAddressTwin) adds Juso/VWorld/Nominatim/Overpass on top.
 */
export function buildPreviewTwin(rawQuery: string): PreviewTwinResult {
  const geocoding = fallbackResult(rawQuery, [
    "Client-side preview: official geocoding/Overpass are not queried in the browser."
  ]);
  const [lon, lat] = geocoding.selected.selected_lon_lat;
  const twin = generateMassing({
    projectId: projectIdFromQuery(rawQuery),
    rawQuery,
    center: { lat, lon },
    geocoding,
    seed: hashQuery(rawQuery)
  });
  const manifest = buildSourceManifest(twin);
  return { twin, manifest };
}
