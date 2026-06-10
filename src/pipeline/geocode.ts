import type { AddressCandidate, GeocodeResult, GeocodeSelected } from "../types/twin";
import { getEnv } from "./env";

const SADANG_FALLBACK = {
  parcelAddress: "서울 동작구 사당동 317-6",
  roadAddress: "서울 동작구 사당로20가길 39",
  buildingName: "행복이가득한집",
  lat: 37.4842,
  lon: 126.96975
};

interface VWorldResponse {
  response?: {
    status?: string;
    result?: {
      point?: {
        x?: string;
        y?: string;
      };
    };
  };
}

interface JusoItem {
  roadAddr?: string;
  roadAddrPart1?: string;
  jibunAddr?: string;
  bdNm?: string;
  admCd?: string;
  rnMgtSn?: string;
}

interface JusoResponse {
  results?: {
    common?: {
      totalCount?: string;
      errorCode?: string;
      errorMessage?: string;
    };
    juso?: JusoItem[];
  };
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanAddressQuery(rawQuery: string): string {
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

function fallbackCoordinate(rawQuery: string): { lat: number; lon: number; note: string } {
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
  let hash = 0;
  for (const char of rawQuery) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const latOffset = (((hash & 0xff) / 255) - 0.5) * 0.012;
  const lonOffset = ((((hash >> 8) & 0xff) / 255) - 0.5) * 0.014;
  return {
    lat: base[1] + latOffset,
    lon: base[2] + lonOffset,
    note: `Using deterministic ${base[3]} approximation because official geocoding is unavailable.`
  };
}

function fallbackResult(rawQuery: string, notes: string[]): GeocodeResult {
  const candidates = normalizeAddressCandidates(rawQuery);
  const approx = fallbackCoordinate(rawQuery);
  const selected: GeocodeSelected = {
    provider: "fallback",
    request_time: nowIso(),
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

async function tryJuso(rawQuery: string, candidates: AddressCandidate[]): Promise<GeocodeResult["normalized"] | undefined> {
  const key = getEnv("JUSO_API_KEY") || getEnv("JUSO_CONFIRM_KEY");
  if (!key) return undefined;

  const keyword = cleanAddressQuery(rawQuery) || candidates[0]?.label || rawQuery;
  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  url.searchParams.set("confmKey", key);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "5");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const body = (await response.json()) as JusoResponse;
    const totalCount = Number(body.results?.common?.totalCount ?? "0");
    const first = body.results?.juso?.[0];
    if (!first || totalCount <= 0) return undefined;
    return {
      provider: "juso",
      request_time: nowIso(),
      result_count: totalCount,
      road_address: first.roadAddrPart1 || first.roadAddr,
      parcel_address: first.jibunAddr,
      building_name: first.bdNm,
      adm_cd: first.admCd,
      rn_mgt_sn: first.rnMgtSn,
      confidence: totalCount === 1 ? "high" : "medium",
      restrictions_note: "Raw Juso response is not persisted; derived address normalization summary only."
    };
  } catch {
    return undefined;
  }
}

function mergeJusoCandidates(candidates: AddressCandidate[], normalized?: GeocodeResult["normalized"]): AddressCandidate[] {
  if (!normalized) return candidates;
  const merged = [...candidates];
  if (normalized.road_address && !merged.some((candidate) => candidate.label === normalized.road_address)) {
    merged.unshift({ label: normalized.road_address, type: "road" });
  }
  if (normalized.parcel_address && !merged.some((candidate) => candidate.label === normalized.parcel_address)) {
    merged.unshift({ label: normalized.parcel_address, type: "parcel" });
  }
  if (normalized.building_name && !merged.some((candidate) => candidate.label === normalized.building_name)) {
    merged.push({ label: normalized.building_name, type: "building_name" });
  }
  return merged;
}

async function tryVWorld(
  rawQuery: string,
  candidates: AddressCandidate[],
  normalized?: GeocodeResult["normalized"]
): Promise<GeocodeResult | undefined> {
  const key = getEnv("VWORLD_API_KEY");
  if (!key) return undefined;

  const ordered = [
    ...candidates.filter((candidate) => candidate.type === "parcel"),
    ...candidates.filter((candidate) => candidate.type === "road"),
    ...candidates.filter((candidate) => candidate.type === "raw")
  ];

  for (const candidate of ordered) {
    const type = candidate.type === "road" ? "road" : "parcel";
    const url = new URL("https://api.vworld.kr/req/address");
    url.searchParams.set("service", "address");
    url.searchParams.set("request", "getCoord");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "epsg:4326");
    url.searchParams.set("format", "json");
    url.searchParams.set("type", type);
    url.searchParams.set("address", candidate.label);
    url.searchParams.set("key", key);

    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = (await response.json()) as VWorldResponse;
      const point = body.response?.result?.point;
      const lon = Number(point?.x);
      const lat = Number(point?.y);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const selected: GeocodeSelected = {
        provider: "vworld",
        request_time: nowIso(),
        address_query: candidate.label,
        result_count: body.response?.status === "OK" ? 1 : 0,
        selected_lon_lat: [lon, lat],
        confidence: normalized ? "high" : "medium",
        restrictions_note: "Raw VWorld response is not persisted; derived coordinate summary only."
      };

      return {
        selected,
        provider: "vworld",
        confidence: normalized ? "high" : "medium",
        candidates,
        normalized,
        notes: [
          ...(normalized ? ["Juso normalized the address before VWorld geocoding."] : []),
          "VWorld geocoder returned a coordinate summary.",
          "Parcel/PNU/building geometry still require official API verification."
        ]
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

async function tryNominatim(rawQuery: string, candidates: AddressCandidate[]): Promise<GeocodeResult | undefined> {
  const userAgent = getEnv("NOMINATIM_USER_AGENT") || "address-twin-preview-mvp/0.1 contact@example.com";

  // Nominatim is a public community service. This adapter is only for occasional
  // manual testing, uses one request per run, and must not be used for bulk geocoding.
  const query = candidates.find((candidate) => candidate.type === "road")?.label ?? candidates[0]?.label ?? rawQuery;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "ko,en"
      }
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as NominatimPlace[];
    const first = body[0];
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

    const selected: GeocodeSelected = {
      provider: "nominatim",
      request_time: nowIso(),
      address_query: query,
      result_count: body.length,
      selected_lon_lat: [lon, lat],
      confidence: "low",
      restrictions_note: "Nominatim attribution required; occasional manual testing only, not bulk geocoding.",
      note: first.display_name
    };

    return {
      selected,
      provider: "nominatim",
      confidence: "low",
      candidates,
      notes: [
        "Nominatim fallback was used for a preview coordinate.",
        "Official Korean address/PNU verification is still required."
      ]
    };
  } catch {
    return undefined;
  }
}

export async function geocodeAddress(rawQuery: string): Promise<GeocodeResult> {
  const initialCandidates = normalizeAddressCandidates(rawQuery);
  const normalized = await tryJuso(rawQuery, initialCandidates);
  const candidates = mergeJusoCandidates(initialCandidates, normalized);
  const notes: string[] = [];
  if (normalized) notes.push("Juso normalized the address; raw Juso response is not persisted.");
  else notes.push("JUSO_API_KEY missing or Juso normalization unavailable.");

  const vworld = await tryVWorld(rawQuery, candidates, normalized);
  if (vworld) return vworld;
  notes.push("VWORLD_API_KEY missing or VWorld geocoder unavailable.");

  const nominatim = await tryNominatim(rawQuery, candidates);
  if (nominatim) return nominatim;
  notes.push("Nominatim fallback unavailable or disabled.");

  const fallback = fallbackResult(rawQuery, notes);
  fallback.normalized = normalized;
  fallback.candidates = candidates;
  return fallback;
}

export function getSadangFallbackAddress() {
  return SADANG_FALLBACK;
}
