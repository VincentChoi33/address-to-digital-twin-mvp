import type { AddressCandidate, GeocodeResult, GeocodeSelected } from "../types/twin";

// Pure, browser-safe address logic. No env/file/network access here:
// the offline preview path in the web app shares this with the Node pipeline.

export const SADANG_FALLBACK = {
  parcelAddress: "서울 동작구 사당동 317-6",
  roadAddress: "서울 동작구 사당로20가길 39",
  buildingName: "행복이가득한집",
  lat: 37.4842,
  lon: 126.96975
};

export function cleanAddressQuery(rawQuery: string): string {
  return rawQuery
    .replace(/디지털\s*트윈|만들어줘|만들어|프리뷰|preview|주소로|생성|공식|정밀|측량|법적/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddressCandidates(rawQuery: string): AddressCandidate[] {
  const cleaned = cleanAddressQuery(rawQuery).replace(/번지/gi, " ").replace(/\s+/g, " ").trim();

  const candidates: AddressCandidate[] = [
    { label: cleaned || SADANG_FALLBACK.parcelAddress, type: "raw" }
  ];

  const mentionsSadangParcel = /사당동\s*317-?6|317-6/.test(rawQuery);
  const mentionsSadangRoad = /사당로20가길\s*39/.test(rawQuery);

  if (mentionsSadangParcel || mentionsSadangRoad) {
    candidates.push(
      { label: SADANG_FALLBACK.parcelAddress, type: "parcel" },
      { label: SADANG_FALLBACK.roadAddress, type: "road" },
      { label: SADANG_FALLBACK.buildingName, type: "building_name" }
    );
  }

  if (/로|길/.test(cleaned) && !candidates.some((candidate) => candidate.type === "road")) {
    candidates.push({ label: cleaned, type: "road" });
  }

  if (/동\s*\d/.test(cleaned) && !candidates.some((candidate) => candidate.type === "parcel")) {
    candidates.push({ label: cleaned, type: "parcel" });
  }

  return candidates;
}

export function hashQuery(rawQuery: string): number {
  let hash = 0;
  for (const char of rawQuery) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function fallbackCoordinate(rawQuery: string): { lat: number; lon: number; note: string } {
  if (/사당동\s*317-?6|317-6|사당로20가길\s*39/.test(rawQuery)) {
    return {
      lat: SADANG_FALLBACK.lat,
      lon: SADANG_FALLBACK.lon,
      note: "Using hardcoded Sadang approximation because official geocoding is unavailable."
    };
  }

  const centroids: Array<[RegExp, number, number, string]> = [
    [/강남구/, 37.5172, 127.0473, "서울 강남구 centroid"],
    [/서초구/, 37.4836, 127.0327, "서울 서초구 centroid"],
    [/동작구/, 37.5124, 126.9393, "서울 동작구 centroid"],
    [/마포구/, 37.5663, 126.9019, "서울 마포구 centroid"],
    [/종로구/, 37.5735, 126.979, "서울 종로구 centroid"],
    [/중구/, 37.5638, 126.9976, "서울 중구 centroid"],
    [/용산구/, 37.5326, 126.9904, "서울 용산구 centroid"],
    [/송파구/, 37.5145, 127.1066, "서울 송파구 centroid"],
    [/서울/, 37.5665, 126.978, "서울시청 centroid"],
    [/부산/, 35.1796, 129.0756, "부산시청 centroid"],
    [/대구/, 35.8714, 128.6014, "대구시청 centroid"],
    [/대전/, 36.3504, 127.3845, "대전시청 centroid"],
    [/광주/, 35.1595, 126.8526, "광주시청 centroid"],
    [/인천/, 37.4563, 126.7052, "인천시청 centroid"]
  ];
  const match = centroids.find(([pattern]) => pattern.test(rawQuery));
  const base = match ?? [/.*/, 37.5665, 126.978, "generic Seoul centroid"];
  const hash = hashQuery(rawQuery);
  const latOffset = (((hash & 0xff) / 255) - 0.5) * 0.012;
  const lonOffset = ((((hash >> 8) & 0xff) / 255) - 0.5) * 0.014;
  return {
    lat: base[1] + latOffset,
    lon: base[2] + lonOffset,
    note: `Using deterministic ${base[3]} approximation because official geocoding is unavailable.`
  };
}

export function fallbackResult(rawQuery: string, notes: string[]): GeocodeResult {
  const candidates = normalizeAddressCandidates(rawQuery);
  const approx = fallbackCoordinate(rawQuery);
  const selected: GeocodeSelected = {
    provider: "fallback",
    request_time: new Date().toISOString(),
    address_query: rawQuery,
    result_count: 1,
    selected_lon_lat: [approx.lon, approx.lat],
    confidence: "low",
    restrictions_note: "approximate preview coordinate; official geocoding required",
    note: "approximate preview coordinate; official geocoding required"
  };

  return {
    selected,
    provider: "fallback",
    confidence: "low",
    candidates,
    notes: [
      ...notes,
      approx.note,
      "Road/parcel/building-name candidates require Juso/VWorld verification."
    ]
  };
}
