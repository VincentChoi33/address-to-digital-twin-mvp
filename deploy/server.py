#!/usr/bin/env python3
"""Zero-dependency static + Gemma/Ollama API server for the MVP deploy."""

from __future__ import annotations

import hashlib
import html
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
GENERATED = DIST / "generated"


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5188"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
GEMMA_MODEL = os.environ.get("GEMMA_MODEL", "gemma3:4b")
NOMINATIM_USER_AGENT = os.environ.get(
    "NOMINATIM_USER_AGENT",
    "address-twin-preview-mvp/0.1 (occasional manual preview; no bulk geocoding)",
)

SADANG = {
    "parcel": "서울 동작구 사당동 317-6",
    "road": "서울 동작구 사당로20가길 39",
    "building": "행복이가득한집",
    "lat": 37.48420,
    "lon": 126.96975,
}

PLACE_ALIASES = [
    {
        "patterns": [re.compile(r"잠실\s*야구장", re.I), re.compile(r"jamsil\s*baseball", re.I)],
        "candidates": [
            {"label": "서울 송파구 올림픽로 25 잠실야구장", "type": "poi"},
            {"label": "서울 송파구 올림픽로 25", "type": "road"},
            {"label": "서울특별시 송파구 잠실동 10", "type": "parcel"},
            {"label": "잠실야구장", "type": "building_name"},
            {"label": "서울종합운동장", "type": "building_name"},
        ],
        "lat": 37.512256478,
        "lon": 127.072915146,
        "note": "Using known POI alias approximation for Jamsil Baseball Stadium.",
    }
]

NOMINATIM_LOCK = threading.Lock()
LAST_NOMINATIM_AT = 0.0
WEB_MERCATOR_RADIUS_M = 6_378_137.0
MAX_SURROUNDING_DIMENSION_M = 180.0
MAX_SURROUNDING_AREA_M2 = 12_000.0
MAX_SURROUNDING_HEIGHT_M = 150.0
MAX_TARGET_HEIGHT_M = 260.0
VWORLD_WMTS_TYPES = {
    "Base": "png",
    "gray": "png",
    "midnight": "png",
    "white": "png",
    "Hybrid": "png",
    "Satellite": "jpeg",
}


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def project_id_for(query: str) -> str:
    if is_sadang(query):
        return "sadang_317_6"
    digest = hashlib.sha1(query.encode("utf-8")).hexdigest()[:10]
    return f"address_{digest}"


def clean_query(query: str) -> str:
    cleaned = re.sub(
        r"디지털\s*트윈|만들어줘|만들어|프리뷰|preview|주소로|생성|공식|정밀|측량|법적",
        " ",
        query,
        flags=re.I,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or query.strip() or SADANG["parcel"]


def is_sadang(query: str) -> bool:
    return bool(re.search(r"사당동\s*317-?6|317-6|사당로20가길\s*39|행복이가득한집", query))


def matched_place_aliases(query: str) -> list[dict[str, Any]]:
    return [alias for alias in PLACE_ALIASES if any(pattern.search(query) for pattern in alias["patterns"])]


def normalize_match_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def feature_name(feature: dict[str, Any], fallback: str = "") -> str:
    props = feature.get("properties") or {}
    return str(props.get("bld_nm") or props.get("buld_nm") or props.get("buld_nm_dc") or fallback or "")


def append_unique_candidate(candidates: list[dict[str, str]], candidate: dict[str, str]) -> None:
    if not any(item["label"] == candidate["label"] and item["type"] == candidate["type"] for item in candidates):
        candidates.append(candidate)


def infer_intent(query: str) -> str:
    return "official_required" if re.search(r"공식|정밀|측량|법적|pnu|건축물대장|필지|실측", query, re.I) else "preview"


def geocoding_display(provider: str) -> str:
    if provider == "vworld":
        return "VWorld 연결"
    if provider == "nominatim":
        return "Nominatim 참고"
    return "공식 GIS 미연결"


def confidence_ko(value: str) -> str:
    return {"high": "높음", "medium": "중간"}.get(value, "낮음")


def normalize_candidates(query: str) -> list[dict[str, str]]:
    cleaned = clean_query(query).replace("번지", " ").strip()
    candidates: list[dict[str, str]] = []

    for alias in matched_place_aliases(query):
        for candidate in alias["candidates"]:
            append_unique_candidate(candidates, candidate)

    append_unique_candidate(candidates, {"label": cleaned, "type": "raw"})

    if is_sadang(query):
        for candidate in [
            {"label": SADANG["parcel"], "type": "parcel"},
            {"label": SADANG["road"], "type": "road"},
            {"label": SADANG["building"], "type": "building_name"},
        ]:
            append_unique_candidate(candidates, candidate)
    if re.search(r"로|길", cleaned) and not any(item["type"] == "road" for item in candidates):
        append_unique_candidate(candidates, {"label": cleaned, "type": "road"})
    if re.search(r"동\s*\d", cleaned) and not any(item["type"] == "parcel" for item in candidates):
        append_unique_candidate(candidates, {"label": cleaned, "type": "parcel"})
    return candidates


def get_url_json(url: str, headers: dict[str, str] | None = None, timeout: int = 12) -> dict[str, Any] | list[Any]:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_url_bytes(url: str, headers: dict[str, str] | None = None, timeout: int = 12) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "application/octet-stream")


def fetch_vworld_wmts_tile(layer: str, z: int, y: int, x: int, ext: str) -> tuple[bytes, str] | None:
    key = os.environ.get("VWORLD_API_KEY")
    expected_ext = VWORLD_WMTS_TYPES.get(layer)
    normalized_ext = "jpeg" if ext == "jpg" else ext
    if not key or expected_ext is None or normalized_ext != expected_ext:
        return None
    if z < 0 or z > 21 or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
        return None

    url = f"https://api.vworld.kr/req/wmts/1.0.0/{urllib.parse.quote(key)}/{layer}/{z}/{y}/{x}.{expected_ext}"
    domain = os.environ.get("VWORLD_DOMAIN", "https://navigation-hosted-specialty-instructors.trycloudflare.com")
    try:
        body, content_type = get_url_bytes(
            url,
            headers={
                "User-Agent": "address-twin-preview-mvp/0.1",
                "Referer": domain,
            },
            timeout=12,
        )
    except Exception:
        return None
    if not body or "json" in content_type or "text" in content_type:
        return None
    return body, "image/jpeg" if expected_ext == "jpeg" else "image/png"


def try_juso(query: str, candidates: list[dict[str, str]]) -> dict[str, Any] | None:
    key = os.environ.get("JUSO_API_KEY") or os.environ.get("JUSO_CONFIRM_KEY")
    if not key:
        return None

    keywords = [clean_query(query)]
    keywords.extend(item["label"] for item in candidates if item["type"] in {"road", "parcel", "poi", "raw"})
    seen: set[str] = set()
    for keyword in keywords:
        if not keyword or keyword in seen:
            continue
        seen.add(keyword)
        params = urllib.parse.urlencode(
            {
                "confmKey": key,
                "currentPage": "1",
                "countPerPage": "5",
                "keyword": keyword,
                "resultType": "json",
            }
        )
        url = f"https://business.juso.go.kr/addrlink/addrLinkApi.do?{params}"
        try:
            body = get_url_json(url)
        except Exception:
            continue

        results = body.get("results", {}) if isinstance(body, dict) else {}
        common = results.get("common", {})
        items = results.get("juso") or []
        total = int(common.get("totalCount") or 0)
        first = items[0] if items and total > 0 else None
        if not first:
            continue
        return {
            "provider": "juso",
            "request_time": now_iso(),
            "result_count": total,
            "road_address": first.get("roadAddrPart1") or first.get("roadAddr"),
            "parcel_address": first.get("jibunAddr"),
            "building_name": first.get("bdNm"),
            "adm_cd": first.get("admCd"),
            "rn_mgt_sn": first.get("rnMgtSn"),
            "confidence": "high" if total == 1 else "medium",
            "restrictions_note": "Raw Juso response is not persisted; derived normalization summary only.",
        }
    return None


def merge_juso_candidates(candidates: list[dict[str, str]], normalized: dict[str, Any] | None) -> list[dict[str, str]]:
    if not normalized:
        return candidates
    merged = list(candidates)
    for label, kind in [
        (normalized.get("road_address"), "road"),
        (normalized.get("parcel_address"), "parcel"),
        (normalized.get("building_name"), "building_name"),
    ]:
        if label and not any(item["label"] == label for item in merged):
            item = {"label": str(label), "type": kind}
            if kind in {"road", "parcel"}:
                merged.insert(0, item)
            else:
                merged.append(item)
    return merged


def try_vworld(
    query: str,
    candidates: list[dict[str, str]],
    normalized: dict[str, Any] | None,
) -> dict[str, Any] | None:
    key = os.environ.get("VWORLD_API_KEY")
    if not key:
        return None

    ordered = [
        *[item for item in candidates if item["type"] == "poi"],
        *[item for item in candidates if item["type"] == "parcel"],
        *[item for item in candidates if item["type"] == "road"],
        *[item for item in candidates if item["type"] == "raw"],
    ]
    for candidate in ordered:
        vworld_type = "road" if candidate["type"] == "road" else "parcel"
        params = urllib.parse.urlencode(
            {
                "service": "address",
                "request": "getCoord",
                "version": "2.0",
                "crs": "epsg:4326",
                "format": "json",
                "type": vworld_type,
                "address": candidate["label"],
                "key": key,
            }
        )
        url = f"https://api.vworld.kr/req/address?{params}"
        try:
            body = get_url_json(url)
            point = body.get("response", {}).get("result", {}).get("point", {})
            lon = float(point.get("x"))
            lat = float(point.get("y"))
        except Exception:
            continue

        confidence = "high" if normalized else "medium"
        selected = {
            "provider": "vworld",
            "request_time": now_iso(),
            "address_query": candidate["label"],
            "result_count": 1 if body.get("response", {}).get("status") == "OK" else 0,
            "selected_lon_lat": [lon, lat],
            "confidence": confidence,
            "restrictions_note": "Raw VWorld response is not persisted; derived coordinate summary only.",
        }
        return {
            "selected": selected,
            "provider": "vworld",
            "confidence": confidence,
            "candidates": candidates,
            "notes": [
                *(["Juso normalized the address before VWorld geocoding."] if normalized else []),
                "VWorld geocoder returned a coordinate summary.",
                "Parcel/PNU/building geometry still require official API verification.",
            ],
            **({"normalized": normalized} if normalized else {}),
        }
    return None


def try_vworld_place(
    query: str,
    candidates: list[dict[str, str]],
    normalized: dict[str, Any] | None,
) -> dict[str, Any] | None:
    key = os.environ.get("VWORLD_API_KEY")
    if not key:
        return None

    keywords = [clean_query(query)]
    keywords.extend(item["label"] for item in candidates if item["type"] in {"poi", "building_name", "raw"})
    seen: set[str] = set()
    for keyword in keywords:
        if not keyword or keyword in seen:
            continue
        seen.add(keyword)
        params = urllib.parse.urlencode(
            {
                "service": "search",
                "request": "search",
                "version": "2.0",
                "crs": "EPSG:4326",
                "size": "5",
                "page": "1",
                "query": keyword,
                "type": "place",
                "format": "json",
                "key": key,
            }
        )
        url = f"https://api.vworld.kr/req/search?{params}"
        try:
            body = get_url_json(url, headers={"User-Agent": "address-twin-preview-mvp/0.1"}, timeout=15)
            response = body.get("response", {}) if isinstance(body, dict) else {}
            items = response.get("result", {}).get("items") or []
            first = items[0] if response.get("status") == "OK" and items else None
            if not first:
                continue
            point = first.get("point") or {}
            lon = float(point.get("x"))
            lat = float(point.get("y"))
        except Exception:
            continue

        title = str(first.get("title") or keyword)
        alias = next(iter(matched_place_aliases(query)), None)
        address = first.get("address") or {}
        road_address = address.get("road")
        parcel_address = address.get("parcel")
        total = int((response.get("record") or {}).get("total") or len(items) or 1)
        exact = normalize_match_text(title) in normalize_match_text(keyword)
        confidence = "high" if exact else "medium"
        if alias and exact:
            lon = float(alias["lon"])
            lat = float(alias["lat"])
        enriched_candidates = list(candidates)
        for candidate in [
            {"label": title, "type": "building_name"},
            *([{"label": str(road_address), "type": "road"}] if road_address else []),
            *([{"label": str(parcel_address), "type": "parcel"}] if parcel_address else []),
        ]:
            append_unique_candidate(enriched_candidates, candidate)

        selected = {
            "provider": "vworld",
            "request_time": now_iso(),
            "address_query": keyword,
            "result_count": total,
            "selected_lon_lat": [lon, lat],
            "confidence": confidence,
            "restrictions_note": "VWorld Search place result; raw response is not persisted, and official parcel/building verification is still required.",
            "note": (
                f"{first.get('category') or 'VWorld place search result'}; known POI alias coordinate used for large-site disambiguation"
                if alias and exact
                else str(first.get("category") or "VWorld place search result")
            ),
            "place_title": title,
            "place_id": first.get("id"),
            "road_address": road_address,
            "parcel_address": parcel_address,
        }
        return {
            "selected": selected,
            "provider": "vworld",
            "confidence": confidence,
            "candidates": enriched_candidates,
            "notes": [
                *(["Juso normalized an address candidate, but VWorld place search was preferred for the POI query."] if normalized else []),
                "VWorld place search resolved a POI/place-name query.",
                "Parcel/PNU/building geometry still require official API verification.",
            ],
            **({"normalized": normalized} if normalized else {}),
        }
    return None


def try_nominatim(
    query: str,
    candidates: list[dict[str, str]],
    normalized: dict[str, Any] | None,
) -> dict[str, Any] | None:
    # Public Nominatim is only for occasional interactive testing. This server
    # sends at most one request per user prompt and rate-limits calls to 1/sec.
    search = (
        normalized.get("road_address")
        if normalized
        else next((item["label"] for item in candidates if item["type"] == "road"), candidates[0]["label"])
    )
    if "대한민국" not in search and "Korea" not in search:
        search = f"{search}, 대한민국"
    params = urllib.parse.urlencode({"format": "jsonv2", "limit": "1", "q": search})
    url = f"https://nominatim.openstreetmap.org/search?{params}"

    global LAST_NOMINATIM_AT
    with NOMINATIM_LOCK:
        wait = 1.05 - (time.monotonic() - LAST_NOMINATIM_AT)
        if wait > 0:
            time.sleep(wait)
        LAST_NOMINATIM_AT = time.monotonic()

    try:
        body = get_url_json(
            url,
            headers={"User-Agent": NOMINATIM_USER_AGENT, "Accept-Language": "ko,en"},
            timeout=15,
        )
        first = body[0] if isinstance(body, list) and body else None
        if not first:
            return None
        lat = float(first["lat"])
        lon = float(first["lon"])
    except Exception:
        return None

    selected = {
        "provider": "nominatim",
        "request_time": now_iso(),
        "address_query": search,
        "result_count": 1,
        "selected_lon_lat": [lon, lat],
        "confidence": "low",
        "restrictions_note": "Nominatim attribution required; occasional manual testing only, not bulk geocoding.",
        "note": first.get("display_name"),
    }
    return {
        "selected": selected,
        "provider": "nominatim",
        "confidence": "low",
        "candidates": candidates,
        "notes": [
            *(["Juso normalized the address before Nominatim preview geocoding."] if normalized else []),
            "Nominatim was used as a best-effort preview coordinate source.",
            "Official Korean address/PNU verification is still required.",
        ],
        **({"normalized": normalized} if normalized else {}),
    }


def fallback_coordinate(query: str) -> tuple[float, float, str]:
    if is_sadang(query):
        return SADANG["lat"], SADANG["lon"], "Using hardcoded Sadang approximation."
    aliases = matched_place_aliases(query)
    if aliases:
        alias = aliases[0]
        return alias["lat"], alias["lon"], alias["note"]

    centroids: list[tuple[re.Pattern[str], float, float, str]] = [
        (re.compile("강남구"), 37.5172, 127.0473, "서울 강남구 centroid"),
        (re.compile("서초구"), 37.4836, 127.0327, "서울 서초구 centroid"),
        (re.compile("동작구"), 37.5124, 126.9393, "서울 동작구 centroid"),
        (re.compile("마포구"), 37.5663, 126.9019, "서울 마포구 centroid"),
        (re.compile("종로구"), 37.5735, 126.9790, "서울 종로구 centroid"),
        (re.compile("중구"), 37.5638, 126.9976, "서울 중구 centroid"),
        (re.compile("용산구"), 37.5326, 126.9904, "서울 용산구 centroid"),
        (re.compile("송파구"), 37.5145, 127.1066, "서울 송파구 centroid"),
        (re.compile("서울"), 37.5665, 126.9780, "서울시청 centroid"),
        (re.compile("부산"), 35.1796, 129.0756, "부산시청 centroid"),
        (re.compile("대구"), 35.8714, 128.6014, "대구시청 centroid"),
        (re.compile("대전"), 36.3504, 127.3845, "대전시청 centroid"),
        (re.compile("광주"), 35.1595, 126.8526, "광주시청 centroid"),
        (re.compile("인천"), 37.4563, 126.7052, "인천시청 centroid"),
    ]
    base_lat, base_lon, label = 37.5665, 126.9780, "generic Seoul centroid"
    for pattern, lat, lon, name in centroids:
        if pattern.search(query):
            base_lat, base_lon, label = lat, lon, name
            break
    digest = hashlib.sha1(query.encode("utf-8")).digest()
    lat = base_lat + ((digest[0] / 255) - 0.5) * 0.012
    lon = base_lon + ((digest[1] / 255) - 0.5) * 0.014
    return lat, lon, f"Using deterministic {label} approximation."


def fallback_geocode(
    query: str,
    candidates: list[dict[str, str]],
    normalized: dict[str, Any] | None,
    notes: list[str],
) -> dict[str, Any]:
    lat, lon, note = fallback_coordinate(query)
    selected = {
        "provider": "fallback",
        "request_time": now_iso(),
        "address_query": clean_query(query),
        "result_count": 1,
        "selected_lon_lat": [lon, lat],
        "confidence": "low",
        "restrictions_note": "Approximate preview coordinate; official geocoding required.",
        "note": "Approximate preview coordinate; official geocoding required.",
    }
    return {
        "selected": selected,
        "provider": "fallback",
        "confidence": "low",
        "candidates": candidates,
        "notes": [*notes, note, "Road/parcel/building-name candidates require Juso/VWorld verification."],
        **({"normalized": normalized} if normalized else {}),
    }


def geocode_address(query: str) -> dict[str, Any]:
    initial_candidates = normalize_candidates(query)
    notes: list[str] = []
    normalized = try_juso(query, initial_candidates)
    if normalized:
        notes.append("Juso normalized the address; raw Juso response is not persisted.")
    else:
        notes.append("JUSO_API_KEY missing or Juso normalization unavailable.")
    candidates = merge_juso_candidates(initial_candidates, normalized)

    if matched_place_aliases(query) or not any(item["type"] in {"road", "parcel"} for item in initial_candidates):
        place = try_vworld_place(query, candidates, normalized)
        if place:
            return place
        notes.append("VWorld place search unavailable for the POI query.")

    vworld = try_vworld(query, candidates, normalized)
    if vworld:
        return vworld
    notes.append("VWORLD_API_KEY missing or VWorld geocoder unavailable.")

    nominatim = try_nominatim(query, candidates, normalized)
    if nominatim:
        nominatim["notes"] = [*notes, *nominatim["notes"]]
        return nominatim
    notes.append("Nominatim fallback unavailable.")
    return fallback_geocode(query, candidates, normalized, notes)


def rectangle(width: float, depth: float, x: float = 0, z: float = 0, rotation: float = 0) -> list[dict[str, float]]:
    points = [
        (-width / 2, -depth / 2),
        (width / 2, -depth / 2),
        (width / 2, depth / 2),
        (-width / 2, depth / 2),
        (-width / 2, -depth / 2),
    ]
    cos_r = math.cos(rotation)
    sin_r = math.sin(rotation)
    return [{"x": x + px * cos_r - pz * sin_r, "z": z + px * sin_r + pz * cos_r} for px, pz in points]


def address_summary(geocoding: dict[str, Any]) -> dict[str, str]:
    normalized = geocoding.get("normalized") or {}
    candidates = geocoding.get("candidates", [])
    first = lambda kind: next((item["label"] for item in candidates if item.get("type") == kind), None)
    selected_info = geocoding.get("selected", {})
    selected = selected_info.get("address_query", "주소 후보")
    return {
        "parcel": selected_info.get("parcel_address") or normalized.get("parcel_address") or first("parcel") or selected,
        "road": selected_info.get("road_address") or normalized.get("road_address") or first("road") or selected,
        "building": selected_info.get("place_title") or normalized.get("building_name") or first("building_name") or "대상 건물 후보",
    }


def procedural_buildings(seed_text: str) -> list[dict[str, Any]]:
    digest = hashlib.sha1(seed_text.encode("utf-8")).digest()
    configs = [
        (-32, -8, 15, 20, 17, 0.08),
        (-30, 22, 20, 13, 12, -0.12),
        (28, -18, 14, 17, 24, 0.15),
        (36, 18, 22, 16, 18, -0.05),
        (-8, 38, 12, 18, 15, 0.18),
        (12, -40, 20, 12, 9, -0.2),
        (54, -5, 15, 21, 27, 0.03),
        (-55, 8, 18, 14, 11, 0.1),
        (-48, -34, 22, 16, 21, -0.08),
        (48, 42, 16, 14, 13, 0.2),
        (4, 58, 28, 12, 16, 0),
        (-2, -62, 24, 15, 19, 0.05),
    ]
    buildings = []
    for index, (x, z, width, depth, height, rotation) in enumerate(configs):
        jitter = (digest[index % len(digest)] / 255 - 0.5) * 4
        h = height + (digest[(index + 5) % len(digest)] % 5)
        buildings.append(
            {
                "id": f"procedural-context-{index + 1}",
                "name": f"주변 매스 {index + 1}",
                "role": "surrounding",
                "footprint": rectangle(width, depth, x + jitter, z - jitter, rotation),
                "height_m": h,
                "floors_estimate": max(2, round(h / 3.4)),
                "source_type": "procedural",
                "confidence": "low",
                "material_hint": "neutral_gray",
            }
        )
    return buildings


def mercator_xy(lon: float, lat: float) -> tuple[float, float]:
    clamped_lat = min(85.05112878, max(-85.05112878, lat))
    lat_rad = math.radians(clamped_lat)
    return (
        WEB_MERCATOR_RADIUS_M * math.radians(lon),
        WEB_MERCATOR_RADIUS_M * math.log(math.tan(math.pi / 4 + lat_rad / 2)),
    )


def lonlat_to_local(center: dict[str, float], lon: float, lat: float) -> dict[str, float]:
    center_x, center_y = mercator_xy(center["lon"], center["lat"])
    point_x, point_y = mercator_xy(lon, lat)
    ground_scale = math.cos(math.radians(center["lat"]))
    return {"x": (point_x - center_x) * ground_scale, "z": (point_y - center_y) * ground_scale}


def local_to_lonlat(center: dict[str, float], point: dict[str, float]) -> dict[str, float]:
    center_x, center_y = mercator_xy(center["lon"], center["lat"])
    ground_scale = math.cos(math.radians(center["lat"])) or 1e-9
    mercator_x = center_x + point["x"] / ground_scale
    mercator_y = center_y + point["z"] / ground_scale
    lon = math.degrees(mercator_x / WEB_MERCATOR_RADIUS_M)
    lat = math.degrees(2 * math.atan(math.exp(mercator_y / WEB_MERCATOR_RADIUS_M)) - math.pi / 2)
    return {"lat": lat, "lon": lon}


def local_area(points: list[dict[str, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for index, point in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        total += point["x"] * nxt["z"] - nxt["x"] * point["z"]
    return abs(total) / 2


def local_centroid(points: list[dict[str, float]]) -> dict[str, float]:
    if not points:
        return {"x": 0.0, "z": 0.0}
    return {
        "x": sum(point["x"] for point in points) / len(points),
        "z": sum(point["z"] for point in points) / len(points),
    }


def local_bounds(points: list[dict[str, float]]) -> dict[str, float]:
    if not points:
        return {"width": 0.0, "depth": 0.0, "max_dimension": 0.0}
    xs = [point["x"] for point in points]
    zs = [point["z"] for point in points]
    width = max(xs) - min(xs)
    depth = max(zs) - min(zs)
    return {"width": width, "depth": depth, "max_dimension": max(width, depth)}


def degree_radius_for_meters(center: dict[str, float], meters: float) -> float:
    latitude_scale = max(0.25, math.cos(math.radians(center["lat"])))
    return meters / (111_320.0 * latitude_scale)


def distance_between_local(a: dict[str, float], b: dict[str, float]) -> float:
    return math.hypot(a["x"] - b["x"], a["z"] - b["z"])


def shifted_points(points: list[dict[str, float]], anchor: dict[str, float]) -> list[dict[str, float]]:
    return [{"x": point["x"] - anchor["x"], "z": point["z"] - anchor["z"]} for point in points]


def apply_local_anchor(
    center: dict[str, float],
    target: dict[str, Any] | None,
    surrounding: list[dict[str, Any]],
    roads: list[dict[str, Any]],
    parcel: dict[str, Any] | None,
) -> tuple[dict[str, float], dict[str, Any]]:
    anchor_source = "geocoder_search_point"
    anchor_point = {"x": 0.0, "z": 0.0}

    if parcel and parcel.get("boundary"):
        anchor_source = "official_parcel_centroid"
        anchor_point = local_centroid(parcel["boundary"])
    elif target and target.get("footprint"):
        anchor_source = "official_target_footprint_centroid" if target.get("source_type") == "official" else "target_preview_centroid"
        anchor_point = local_centroid(target["footprint"])

    anchored_center = local_to_lonlat(center, anchor_point)

    if target and target.get("footprint"):
        target["footprint"] = shifted_points(target["footprint"], anchor_point)
    for building in surrounding:
        if building.get("footprint"):
            building["footprint"] = shifted_points(building["footprint"], anchor_point)
    for road in roads:
        if road.get("centerline"):
            road["centerline"] = shifted_points(road["centerline"], anchor_point)
    if parcel and parcel.get("boundary"):
        parcel["boundary"] = shifted_points(parcel["boundary"], anchor_point)

    spatial_reference = {
        "crs": "EPSG:4326",
        "local_frame": "local_meter_tangent_plane",
        "projection": "WebMercator-derived local meters with latitude scale correction",
        "anchor_source": anchor_source,
        "anchor_lon_lat": [anchored_center["lon"], anchored_center["lat"]],
        "search_lon_lat": [center["lon"], center["lat"]],
        "texture_alignment": "Satellite WMTS tiles are draped as a visual texture onto the cadastral/WFS local meter frame; cadastral geometry is the alignment authority.",
    }
    return anchored_center, spatial_reference


def point_in_polygon(point: dict[str, float], polygon: list[dict[str, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, current in enumerate(polygon):
        previous = polygon[j]
        crosses = (current["z"] > point["z"]) != (previous["z"] > point["z"])
        if crosses:
            x_intersect = (previous["x"] - current["x"]) * (point["z"] - current["z"]) / (
                previous["z"] - current["z"] or 1e-9
            ) + current["x"]
            if point["x"] < x_intersect:
                inside = not inside
        j = i
    return inside


def polygon_from_geojson(center: dict[str, float], geometry: dict[str, Any]) -> list[dict[str, float]]:
    geom_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    rings: list[list[Any]] = []
    if geom_type == "Polygon":
        rings = [coordinates[0]] if coordinates else []
    elif geom_type == "MultiPolygon":
        rings = [polygon[0] for polygon in coordinates if polygon]

    local_rings = []
    for ring in rings:
        points = [lonlat_to_local(center, float(lon), float(lat)) for lon, lat, *_ in ring]
        if len(points) >= 4:
            local_rings.append(points)
    if not local_rings:
        return []
    return max(local_rings, key=local_area)


def lines_from_geojson(center: dict[str, float], geometry: dict[str, Any]) -> list[list[dict[str, float]]]:
    geom_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    lines = coordinates if geom_type == "MultiLineString" else [coordinates] if geom_type == "LineString" else []
    result = []
    for line in lines:
        points = [lonlat_to_local(center, float(lon), float(lat)) for lon, lat, *_ in line]
        if len(points) >= 2:
            result.append(points)
    return result


def numeric(value: Any) -> float | None:
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def first_numeric(props: dict[str, Any], names: tuple[str, ...]) -> float | None:
    for name in names:
        value = numeric(props.get(name))
        if value is not None:
            return value
    return None


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def feature_identity(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    for name in ("bd_mgt_sn", "bldrgst_pk", "pnu", "pk", "geoidn"):
        value = props.get(name)
        if value:
            return f"{name}:{value}"
    return f"id:{feature.get('id')}"


def dedupe_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    seen: set[str] = set()
    for feature in features:
        identity = feature_identity(feature)
        if identity in seen:
            continue
        seen.add(identity)
        result.append(feature)
    return result


def parcel_main_sub(text: str) -> tuple[int, int, bool] | None:
    if not text:
        return None
    match = re.search(r"(산\s*)?(\d+)(?:-(\d+))?", text)
    if not match:
        return None
    mountain, main, sub = match.groups()
    return int(main), int(sub or 0), bool(mountain)


def expected_pnu_from_geocoding(geocoding: dict[str, Any]) -> str | None:
    normalized = geocoding.get("normalized") or {}
    adm_cd = str(normalized.get("adm_cd") or "").strip()
    parcel_text = (
        str(geocoding.get("selected", {}).get("parcel_address") or "")
        or str(normalized.get("parcel_address") or "")
        or address_summary(geocoding)["parcel"]
    )
    parsed = parcel_main_sub(parcel_text)
    if not adm_cd or len(adm_cd) != 10 or not parsed:
        return None
    main, sub, is_mountain = parsed
    land_code = "2" if is_mountain else "1"
    return f"{adm_cd}{land_code}{main:04d}{sub:04d}"


def fetch_wfs_layer(layer: str, center: dict[str, float], radius_degrees: float, maxfeatures: int = 30) -> list[dict[str, Any]]:
    key = os.environ.get("VWORLD_API_KEY")
    if not key:
        return []
    domain = os.environ.get("VWORLD_DOMAIN", "https://navigation-hosted-specialty-instructors.trycloudflare.com")
    bbox = ",".join(
        str(value)
        for value in [
            center["lat"] - radius_degrees,
            center["lon"] - radius_degrees,
            center["lat"] + radius_degrees,
            center["lon"] + radius_degrees,
        ]
    )
    params = urllib.parse.urlencode(
        {
            "service": "WFS",
            "request": "GetFeature",
            "version": "1.1.0",
            "typename": layer,
            "bbox": bbox,
            "srsname": "EPSG:4326",
            "output": "application/json",
            "maxfeatures": str(maxfeatures),
            "exceptions": "text/xml",
            "domain": domain,
            "key": key,
        }
    )
    url = f"https://api.vworld.kr/req/wfs?{params}"
    try:
        body = get_url_json(url, headers={"User-Agent": "address-twin-preview-mvp/0.1"}, timeout=20)
    except Exception:
        return []
    if not isinstance(body, dict):
        return []
    features = body.get("features")
    return features if isinstance(features, list) else []


def fetch_wfs_equal_filter(layer: str, property_name: str, literal: str) -> list[dict[str, Any]]:
    key = os.environ.get("VWORLD_API_KEY")
    if not key or not literal:
        return []
    domain = os.environ.get("VWORLD_DOMAIN", "https://navigation-hosted-specialty-instructors.trycloudflare.com")
    filter_xml = (
        f'<ogc:Filter><ogc:PropertyIsEqualTo matchCase="true">'
        f"<ogc:PropertyName>{html.escape(property_name)}</ogc:PropertyName>"
        f"<ogc:Literal>{html.escape(literal)}</ogc:Literal>"
        f"</ogc:PropertyIsEqualTo></ogc:Filter>"
    )
    params = urllib.parse.urlencode(
        {
            "service": "WFS",
            "request": "GetFeature",
            "version": "1.1.0",
            "typename": layer,
            "srsname": "EPSG:4326",
            "output": "application/json",
            "maxfeatures": "5",
            "exceptions": "text/xml",
            "domain": domain,
            "filter": filter_xml,
            "key": key,
        }
    )
    url = f"https://api.vworld.kr/req/wfs?{params}"
    try:
        body = get_url_json(url, headers={"User-Agent": "address-twin-preview-mvp/0.1"}, timeout=20)
    except Exception:
        return []
    if not isinstance(body, dict):
        return []
    features = body.get("features")
    return features if isinstance(features, list) else []


def select_nearest_polygon(features: list[dict[str, Any]], center: dict[str, float]) -> dict[str, Any] | None:
    candidates = []
    origin = {"x": 0.0, "z": 0.0}
    for feature in features:
        polygon = polygon_from_geojson(center, feature.get("geometry") or {})
        if not polygon:
            continue
        centroid = local_centroid(polygon)
        distance = math.hypot(centroid["x"], centroid["z"])
        contains = point_in_polygon(origin, polygon)
        candidates.append((0 if contains else 1, distance, feature, polygon))
    if not candidates:
        return None
    _, _, feature, polygon = min(candidates, key=lambda item: (item[0], item[1]))
    feature["_local_polygon"] = polygon
    return feature


def select_polygon_by_pnu(
    features: list[dict[str, Any]],
    center: dict[str, float],
    expected_pnu: str | None,
    preferred_name: str = "",
) -> dict[str, Any] | None:
    if not expected_pnu:
        return None
    matches = []
    origin = {"x": 0.0, "z": 0.0}
    preferred = normalize_match_text(preferred_name)
    for feature in features:
        props = feature.get("properties") or {}
        if str(props.get("pnu") or "") != expected_pnu:
            continue
        polygon = polygon_from_geojson(center, feature.get("geometry") or {})
        if not polygon:
            continue
        centroid = local_centroid(polygon)
        name = normalize_match_text(feature_name(feature))
        name_score = 0 if preferred and (preferred in name or name in preferred) else 1
        matches.append(
            (
                name_score,
                0 if point_in_polygon(origin, polygon) else 1,
                math.hypot(centroid["x"], centroid["z"]),
                feature,
                polygon,
            )
        )
    if not matches:
        return None
    _, _, _, feature, polygon = min(matches, key=lambda item: (item[0], item[1], item[2]))
    feature["_local_polygon"] = polygon
    return feature


def parcel_number_tokens(text: str) -> set[str]:
    tokens = set()
    for match in re.finditer(r"(\d+)(?:-(\d+))?", text):
        main, sub = match.groups()
        if sub:
            tokens.add(f"{int(main)}-{int(sub)}")
        else:
            tokens.add(str(int(main)))
    return tokens


def select_parcel_feature(
    features: list[dict[str, Any]],
    center: dict[str, float],
    summary: dict[str, str],
    preferred_pnu: str | None,
) -> dict[str, Any] | None:
    if preferred_pnu:
        for feature in features:
            props = feature.get("properties") or {}
            if str(props.get("pnu") or "") == preferred_pnu:
                polygon = polygon_from_geojson(center, feature.get("geometry") or {})
                if polygon:
                    feature["_local_polygon"] = polygon
                    return feature

    expected_tokens = parcel_number_tokens(summary.get("parcel", ""))
    if expected_tokens:
        scored = []
        for feature in features:
            props = feature.get("properties") or {}
            haystack = " ".join(str(props.get(name) or "") for name in ("addr", "jibun", "bonbun", "bubun", "pnu"))
            actual_tokens = parcel_number_tokens(haystack)
            if expected_tokens & actual_tokens:
                polygon = polygon_from_geojson(center, feature.get("geometry") or {})
                if polygon:
                    centroid = local_centroid(polygon)
                    scored.append((math.hypot(centroid["x"], centroid["z"]), feature, polygon))
        if scored:
            _, feature, polygon = min(scored, key=lambda item: item[0])
            feature["_local_polygon"] = polygon
            return feature

    return select_nearest_polygon(features, center)


def rectangle_on_points(points: list[dict[str, float]], width: float = 18, depth: float = 13) -> list[dict[str, float]]:
    centroid = local_centroid(points)
    bounds = local_bounds(points)
    safe_width = min(width, max(7.0, bounds["width"] * 0.72 if bounds["width"] else width))
    safe_depth = min(depth, max(7.0, bounds["depth"] * 0.72 if bounds["depth"] else depth))
    return rectangle(safe_width, safe_depth, centroid["x"], centroid["z"], 0.0)


def make_building_feature(
    feature: dict[str, Any],
    center: dict[str, float],
    role: str,
    fallback_name: str,
    index: int = 0,
) -> dict[str, Any] | None:
    polygon = feature.get("_local_polygon") or polygon_from_geojson(center, feature.get("geometry") or {})
    area = local_area(polygon)
    if not polygon or area < 6:
        return None
    props = feature.get("properties") or {}
    bounds = local_bounds(polygon)

    # lt_c_spbd.bld_s is a road-address building number, not floor count.
    # Using it as floors creates impossible preview towers such as 500m+ context masses.
    floors = first_numeric(props, ("grnd_flr", "gro_flo_co", "flr_cnt", "tot_floor"))
    height = first_numeric(props, ("height", "buld_hgt", "bld_hgt", "hgt")) or (floors * 3.2 if floors else None)
    fallback_height = 21 if role == "target" else 12 + (index % 4) * 3
    max_height = MAX_TARGET_HEIGHT_M if role == "target" else MAX_SURROUNDING_HEIGHT_M
    height_m = round(clamp(height or fallback_height, 3.0, max_height), 2)
    name = feature_name(feature, fallback_name)
    return {
        "id": f"vworld-{role}-{feature.get('id', index)}",
        "name": str(name) if str(name).strip() else fallback_name,
        "role": role,
        "footprint": polygon,
        "height_m": height_m,
        "floors_estimate": max(1, round(floors or (height_m / 3.2))),
        "source_type": "official",
        "confidence": "high" if role == "target" else "medium",
        "material_hint": "teal_target" if role == "target" else "neutral_gray",
        "source_ref": {
            "provider": "VWorld WFS",
            "feature_id": feature.get("id"),
            "pnu": props.get("pnu"),
            "layer_hint": "lt_c_bldginfo/lt_c_spbd",
        },
        "geometry_metrics": {
            "area_m2": round(area, 1),
            "width_m": round(bounds["width"], 1),
            "depth_m": round(bounds["depth"], 1),
            "max_dimension_m": round(bounds["max_dimension"], 1),
        },
    }


def is_usable_surrounding_feature(feature: dict[str, Any], target_feature: dict[str, Any] | None) -> bool:
    polygon = feature.get("_local_polygon") or []
    area = local_area(polygon)
    bounds = local_bounds(polygon)
    if bounds["max_dimension"] > MAX_SURROUNDING_DIMENSION_M or area > MAX_SURROUNDING_AREA_M2:
        return False

    if not target_feature:
        return True

    props = feature.get("properties") or {}
    target_props = target_feature.get("properties") or {}
    for name in ("bd_mgt_sn", "bldrgst_pk"):
        if props.get(name) and props.get(name) == target_props.get(name):
            return False

    # Same-PNU features often duplicate the target between lt_c_bldginfo and lt_c_spbd
    # or represent a huge connected facility. Keep them out of "surrounding" massing.
    if props.get("pnu") and props.get("pnu") == target_props.get("pnu"):
        return False
    return True


def context_radius_m(target: dict[str, Any] | None, parcel: dict[str, Any] | None) -> float:
    dimensions = [130.0]
    target_dimension = ((target or {}).get("geometry_metrics") or {}).get("max_dimension_m")
    if target_dimension:
        dimensions.append(float(target_dimension) * 2.1)
    if parcel and parcel.get("boundary"):
        dimensions.append(local_bounds(parcel["boundary"])["max_dimension"] * 2.1)
    return clamp(max(dimensions), 130.0, 340.0)


def select_surrounding_features(
    features: list[dict[str, Any]],
    center: dict[str, float],
    anchor: dict[str, float],
    target_feature: dict[str, Any] | None,
    radius_m: float,
    limit: int,
) -> list[dict[str, Any]]:
    scored = []
    seen = {feature_identity(target_feature)} if target_feature else set()
    for feature in features:
        if target_feature and feature.get("id") == target_feature.get("id"):
            continue
        identity = feature_identity(feature)
        if identity in seen:
            continue
        polygon = polygon_from_geojson(center, feature.get("geometry") or {})
        if not polygon:
            continue
        feature["_local_polygon"] = polygon
        if not is_usable_surrounding_feature(feature, target_feature):
            continue
        centroid = local_centroid(polygon)
        distance = distance_between_local(centroid, anchor)
        if distance > radius_m:
            continue
        scored.append((distance, local_area(polygon), identity, feature))
        seen.add(identity)
    scored.sort(key=lambda item: (item[0], -item[1]))
    return [feature for _, _, _, feature in scored[:limit]]


def fetch_vworld_wfs_context(center: dict[str, float], summary: dict[str, str], geocoding: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("VWORLD_API_KEY") is None:
        return {"buildings": [], "roads": [], "parcel": None, "notes": ["VWORLD_API_KEY missing; WFS skipped."]}

    radius = degree_radius_for_meters(center, 160.0)
    expected_pnu = expected_pnu_from_geocoding(geocoding)
    parcel_features = [
        *fetch_wfs_layer("lp_pa_cbnd_bubun", center, radius, 8),
        *fetch_wfs_layer("lp_pa_cbnd_bonbun", center, radius, 8),
    ]
    bldginfo_features = fetch_wfs_layer("lt_c_bldginfo", center, radius, 80)
    spbd_features = fetch_wfs_layer("lt_c_spbd", center, radius, 80)
    road_features = fetch_wfs_layer("lt_l_sprd", center, radius, 24)

    if expected_pnu:
        parcel_features = dedupe_features(
            [
                *fetch_wfs_equal_filter("lp_pa_cbnd_bubun", "pnu", expected_pnu),
                *fetch_wfs_equal_filter("lp_pa_cbnd_bonbun", "pnu", expected_pnu),
                *parcel_features,
            ]
        )
        bldginfo_features = dedupe_features(
            [*fetch_wfs_equal_filter("lt_c_bldginfo", "pnu", expected_pnu), *bldginfo_features]
        )
        spbd_features = dedupe_features([*fetch_wfs_equal_filter("lt_c_spbd", "pnu", expected_pnu), *spbd_features])

    selected_building = select_polygon_by_pnu(
        [*bldginfo_features, *spbd_features],
        center,
        expected_pnu,
        summary["building"],
    )
    if selected_building is None and expected_pnu is None:
        selected_building = select_nearest_polygon(bldginfo_features, center) or select_nearest_polygon(spbd_features, center)
    preferred_pnu = expected_pnu or (str((selected_building.get("properties") or {}).get("pnu") or "") if selected_building else "")
    if preferred_pnu and not any(str((feature.get("properties") or {}).get("pnu") or "") == preferred_pnu for feature in parcel_features):
        parcel_features = [*fetch_wfs_equal_filter("lp_pa_cbnd_bubun", "pnu", preferred_pnu), *parcel_features]
    target = (
        make_building_feature(selected_building, center, "target", summary["building"])
        if selected_building
        else None
    )

    selected_parcel = select_parcel_feature(parcel_features, center, summary, preferred_pnu or None)
    parcel = None
    if selected_parcel:
        props = selected_parcel.get("properties") or {}
        parcel = {
            "id": f"vworld-parcel-{selected_parcel.get('id', 'selected')}",
            "name": str(props.get("addr") or props.get("jibun") or summary["parcel"] or "VWorld 연속지적도"),
            "boundary": selected_parcel["_local_polygon"],
            "source_type": "official",
            "confidence": "high",
            "source_ref": {
                "provider": "VWorld WFS",
                "feature_id": selected_parcel.get("id"),
                "pnu": props.get("pnu"),
                "layer_hint": "lp_pa_cbnd_bubun/lp_pa_cbnd_bonbun",
            },
        }

    if target is None and parcel is not None:
        target = {
            "id": "parcel-anchored-target-candidate",
            "name": summary["building"],
            "role": "target",
            "footprint": rectangle_on_points(parcel["boundary"]),
            "height_m": 21,
            "floors_estimate": 5,
            "source_type": "procedural",
            "confidence": "low",
            "material_hint": "teal_target",
            "source_ref": {
                "provider": "VWorld WFS parcel anchor",
                "feature_id": parcel.get("source_ref", {}).get("feature_id"),
                "pnu": parcel.get("source_ref", {}).get("pnu"),
                "layer_hint": "target mass is approximate and centered on the selected official parcel boundary",
            },
        }

    anchor_point = {"x": 0.0, "z": 0.0}
    if parcel and parcel.get("boundary"):
        anchor_point = local_centroid(parcel["boundary"])
    elif target and target.get("footprint"):
        anchor_point = local_centroid(target["footprint"])

    radius_m = context_radius_m(target, parcel)
    anchor_center = local_to_lonlat(center, anchor_point)
    anchor_radius = degree_radius_for_meters(anchor_center, radius_m)
    bldginfo_features = dedupe_features(
        [
            *bldginfo_features,
            *fetch_wfs_layer("lt_c_bldginfo", anchor_center, anchor_radius, 120),
        ]
    )
    spbd_features = dedupe_features(
        [
            *spbd_features,
            *fetch_wfs_layer("lt_c_spbd", anchor_center, anchor_radius, 120),
        ]
    )
    road_features = dedupe_features([*road_features, *fetch_wfs_layer("lt_l_sprd", anchor_center, anchor_radius, 32)])

    surrounding = []
    target_metrics = (target or {}).get("geometry_metrics") or {}
    is_large_place_target = bool(geocoding.get("selected", {}).get("place_title")) and (
        float(target_metrics.get("max_dimension_m") or 0) > 120 or float(target_metrics.get("area_m2") or 0) > 3_000
    )
    if not is_large_place_target:
        for index, feature in enumerate(
            select_surrounding_features(
                [*bldginfo_features, *spbd_features],
                center,
                anchor_point,
                selected_building,
                radius_m,
                16,
            )
        ):
            item = make_building_feature(feature, center, "surrounding", f"VWorld 주변 건물 {index + 1}", index)
            if item:
                item["id"] = f"vworld-context-{index + 1}"
                item["distance_from_anchor_m"] = round(
                    distance_between_local(local_centroid(feature.get("_local_polygon") or []), anchor_point),
                    1,
                )
                surrounding.append(item)

    roads = []
    for index, feature in enumerate(road_features[:8]):
        props = feature.get("properties") or {}
        for line_index, line in enumerate(lines_from_geojson(center, feature.get("geometry") or {})):
            width = numeric(props.get("road_bt")) or numeric(props.get("road_py_lt")) or 5.5
            roads.append(
                {
                    "id": f"vworld-road-{index + 1}-{line_index + 1}",
                    "name": str(props.get("rn") or props.get("eng_rn") or "VWorld 도로명주소도로"),
                    "centerline": line,
                    "width_m": min(max(width, 3.0), 16.0),
                    "source_type": "official",
                    "confidence": "medium",
                }
            )
            if len(roads) >= 8:
                break
        if len(roads) >= 8:
            break

    anchored_center, spatial_reference = apply_local_anchor(center, target, surrounding, roads, parcel)
    notes = [
        f"VWorld WFS returned {len(parcel_features)} parcel, {len(bldginfo_features) + len(spbd_features)} building, and {len(road_features)} road features near the selected coordinate.",
        f"Expected PNU from normalized parcel/address: {expected_pnu}." if expected_pnu else "Expected PNU could not be derived from normalized address.",
        "Large POI target detected; surrounding context massing is suppressed to avoid unrelated facility clutter." if is_large_place_target else "Nearby WFS building footprints are eligible for surrounding context massing.",
        f"Surrounding context candidates are selected by distance from the official local anchor within {round(radius_m)} m, then filtered for duplicate/same-PNU/oversized footprints.",
        f"Local 3D origin is anchored to {spatial_reference['anchor_source']}; satellite imagery is only draped as a visual texture over that WFS/cadastral frame.",
        "WFS/cadastral geometry is the alignment authority; WMTS satellite imagery is a preview texture, not the legal geometry source.",
    ]
    return {
        "target": target,
        "buildings": surrounding,
        "roads": roads,
        "parcel": parcel,
        "center": anchored_center,
        "spatial_reference": spatial_reference,
        "notes": notes,
    }


def build_twin(query: str, geocoding: dict[str, Any]) -> dict[str, Any]:
    lon, lat = geocoding["selected"]["selected_lon_lat"]
    summary = address_summary(geocoding)
    center = {"lat": lat, "lon": lon}
    wfs = fetch_vworld_wfs_context(center, summary, geocoding) if geocoding["provider"] == "vworld" else None
    if wfs:
        geocoding["notes"] = [*geocoding.get("notes", []), *wfs["notes"]]
    render_center = (wfs or {}).get("center") or center
    spatial_reference = (wfs or {}).get("spatial_reference") or {
        "crs": "EPSG:4326",
        "local_frame": "local_meter_tangent_plane",
        "projection": "WebMercator-derived local meters with latitude scale correction",
        "anchor_source": "geocoder_search_point",
        "anchor_lon_lat": [center["lon"], center["lat"]],
        "search_lon_lat": [center["lon"], center["lat"]],
        "texture_alignment": "No official parcel/building anchor was available; satellite imagery and procedural massing are centered on the geocoder search point.",
    }
    warning = (
        "프리뷰 전용입니다. Juso/VWorld/WFS 데이터가 연결되었으며, 최종 납품 전 공식 원천 대조와 현장 검증이 필요합니다."
        if wfs and (wfs.get("target") or wfs.get("parcel"))
        else "프리뷰 전용입니다. Juso/VWorld 좌표는 연결되었고, 필지·건물 형상은 추가 공식 데이터 확인이 필요합니다."
        if geocoding["provider"] == "vworld"
        else "프리뷰 전용입니다. 현재 좌표·필지·건물 형상은 근사치이며 공식 데이터 연결이 필요합니다."
    )
    target = (wfs or {}).get("target") or {
        "id": "target-building",
        "name": summary["building"],
        "role": "target",
        "footprint": rectangle(18, 13, 0, 0, -0.06),
        "height_m": 21,
        "floors_estimate": 5,
        "source_type": "procedural",
        "confidence": "low",
        "material_hint": "teal_target",
    }
    wfs_surrounding = (wfs or {}).get("buildings") or []
    surrounding = wfs_surrounding if wfs_surrounding else [] if wfs else procedural_buildings(query)
    if wfs:
        if wfs_surrounding:
            geocoding["notes"].append(
                "Surrounding context massing uses VWorld WFS footprints only; procedural fill is suppressed."
            )
        else:
            geocoding["notes"].append(
                "No nearby VWorld WFS building footprints were selected; procedural surrounding massing is suppressed because official spatial data is connected."
            )
    roads = (wfs or {}).get("roads") or [
        {
            "id": "procedural-road-main",
            "name": "주변 도로 방향 추정",
            "centerline": [{"x": -74, "z": -23}, {"x": 74, "z": -5}],
            "width_m": 6,
            "source_type": "procedural",
            "confidence": "low",
        },
        {
            "id": "procedural-road-alley",
            "name": "골목 연결 추정",
            "centerline": [{"x": 20, "z": -72}, {"x": 9, "z": 70}],
            "width_m": 4.2,
            "source_type": "procedural",
            "confidence": "low",
        },
    ]
    parcel = (wfs or {}).get("parcel") or {
        "id": "approx-parcel-boundary",
        "name": "필지 경계 추정",
        "boundary": rectangle(25, 19, 0, 0, 0.07),
        "source_type": "procedural",
        "confidence": "low",
    }
    return {
        "project_id": project_id_for(query),
        "created_at": now_iso(),
        "input": {"raw_query": query, "normalized_address_candidates": geocoding["candidates"]},
        "center": render_center,
        "spatial_reference": spatial_reference,
        "addresses": {
            "parcel_address": summary["parcel"],
            "road_address_candidate": summary["road"],
            "building_name_candidate": summary["building"],
        },
        "geocoding": geocoding,
        "buildings": [target, *surrounding[:18]],
        "roads": roads,
        "pois": [],
        "parcel": parcel,
        "basemap": {
            "default_source": "VWorld WMTS" if os.environ.get("VWORLD_API_KEY") else "ArcGIS World Imagery",
            "attribution": "Default ground is procedural/offline. VWorld WMTS or ArcGIS World Imagery satellite tiles are requested live; no local tile caching.",
            "tile_template": "/api/vworld/wmts/Satellite/{z}/{y}/{x}.jpeg" if os.environ.get("VWORLD_API_KEY") else "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "offline_fallback": "procedural_grid",
        },
        "viewer": {"initial_camera": {"position": [58, 58, 74], "target": [0, 7, 0]}, "warning": warning},
    }


def build_manifest(twin: dict[str, Any]) -> dict[str, Any]:
    has_vworld = twin["geocoding"]["provider"] == "vworld"
    target = next((building for building in twin["buildings"] if building.get("role") == "target"), {})
    has_wfs_target = target.get("source_type") == "official"
    has_procedural_context = any(building.get("source_type") == "procedural" for building in twin["buildings"] if building.get("role") == "surrounding")
    has_wfs_context = any(building.get("source_type") == "official" for building in twin["buildings"] if building.get("role") == "surrounding")
    has_wfs_parcel = twin["parcel"].get("source_type") == "official"
    has_wfs_roads = any(road.get("source_type") == "official" for road in twin["roads"])
    has_vworld_tiles = bool(os.environ.get("VWORLD_API_KEY"))
    spatial_reference = twin.get("spatial_reference") or {}
    return {
        "project_id": twin["project_id"],
        "generated_at": now_iso(),
        "input": twin["input"],
        "geocoding": {
            "selected": twin["geocoding"]["selected"],
            "provider": twin["geocoding"]["provider"],
            "confidence": twin["geocoding"]["confidence"],
            "notes": twin["geocoding"]["notes"],
        },
        "layers": [
            {
                "name": "satellite_ground",
                "source": "VWorld WMTS live proxy" if has_vworld_tiles else "procedural",
                "usage": "visual texture draped onto cadastral/WFS local meter frame",
                "confidence": "medium" if has_vworld_tiles else "low",
                "license_note": "VWorld/ArcGIS/custom tiles are optional browser preview sources. This MVP requests live tiles only and does not cache or persist them.",
            },
            {
                "name": "spatial_reference",
                "source": spatial_reference.get("anchor_source", "unknown"),
                "usage": "local origin and geometry alignment authority",
                "confidence": "high" if has_wfs_parcel else "medium" if has_wfs_target else "low",
                "license_note": "Cadastral/WFS geometry determines preview alignment; imagery is not used to infer legal boundaries.",
            },
            {"name": "target_building_massing", "source": "VWorld WFS building footprint" if has_wfs_target else "procedural fallback", "confidence": target.get("confidence", "low")},
            {
                "name": "surrounding_context_massing",
                "source": "VWorld WFS building footprints only" if has_wfs_context else "procedural fallback" if has_procedural_context else "no surrounding footprints selected",
                "confidence": "medium" if has_wfs_context else "low",
            },
            {"name": "parcel_boundary", "source": "VWorld WFS continuous cadastral map" if has_wfs_parcel else "procedural fallback", "confidence": twin["parcel"].get("confidence", "low")},
            {"name": "road_hints", "source": "VWorld WFS road-name road layer" if has_wfs_roads else "procedural fallback", "confidence": "medium" if has_wfs_roads else "low"},
        ],
        "limitations": [
            "Not survey-grade",
            "Exact PNU/parcel boundary not legally certified by this MVP",
            "Building footprint/height should be reviewed against official records before production use",
            "VWorld/Juso/WFS geometry is connected" if has_wfs_target or has_wfs_parcel else "VWorld/Juso geocoding is connected" if has_vworld else "Preview coordinate may be approximate until VWorld/Juso verification succeeds",
            "Optional basemap tiles are for browser preview only and are not cached by this MVP",
            "Satellite imagery is a texture layer draped over the cadastral/WFS frame; it is not the source of parcel or building geometry",
        ],
        "next_actions": [
            "Add Juso and VWorld keys" if not has_vworld else "Resolve and persist selected PNU",
            "Cross-check WFS parcel boundary against selected Juso/VWorld address",
            "Fetch/compare GIS building integrated info attributes",
            "Generate official-review LOD1/LOD2 geometry",
            "Export glTF/3D Tiles",
        ],
    }


def qa_report_html(twin: dict[str, Any], manifest: dict[str, Any]) -> str:
    rows = "\n".join(
        f"<tr><td>{html.escape(layer['name'])}</td><td>{html.escape(layer['source'])}</td><td>{confidence_ko(layer.get('confidence', 'low'))}</td></tr>"
        for layer in manifest["layers"]
    )
    limitations = "".join(f"<li>{html.escape(item)}</li>" for item in manifest["limitations"])
    actions = "".join(f"<li>{html.escape(item)}</li>" for item in manifest["next_actions"])
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{html.escape(twin["project_id"])} QA Report</title>
<style>body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f3ed;color:#1d1b16;margin:0}}main{{max-width:960px;margin:0 auto;padding:36px 20px}}.notice{{background:#fff4cf;border:1px solid #e5c96a;border-radius:8px;padding:14px}}table{{width:100%;border-collapse:collapse;background:#fff}}td,th{{padding:10px;border:1px solid #ded8cb;text-align:left}}code{{background:#eee7d9;padding:2px 5px;border-radius:4px}}</style>
</head><body><main>
<h1>QA / Confidence Report</h1>
<p class="notice">이 산출물은 제안·검토용 프리뷰입니다. 측량급 또는 법적 효력이 있는 디지털 트윈이 아닙니다.</p>
<p><b>입력 주소</b>: {html.escape(twin["input"]["raw_query"])}</p>
<p><b>좌표</b>: <code>{twin["center"]["lat"]:.5f}, {twin["center"]["lon"]:.5f}</code> / <b>공급자</b>: <code>{html.escape(twin["geocoding"]["provider"])}</code></p>
<h2>생성된 것</h2><p>브라우저 3D 프리뷰, 대상 건물 매스, 주변 매스, 필지 경계, 도로 힌트.</p>
<h2>검증이 필요한 것</h2><ul>{limitations}</ul>
<h2>레이어별 신뢰도</h2><table><thead><tr><th>레이어</th><th>출처</th><th>신뢰도</th></tr></thead><tbody>{rows}</tbody></table>
<h2>다음 권장 업그레이드</h2><ol>{actions}</ol>
</main></body></html>"""


def persist_project(twin: dict[str, Any], manifest: dict[str, Any]) -> dict[str, str]:
    project_dir = GENERATED / twin["project_id"]
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "twin.json").write_text(json.dumps(twin, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (project_dir / "source_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (project_dir / "qa_report.html").write_text(qa_report_html(twin, manifest), encoding="utf-8")
    target = f"/?q={urllib.parse.quote(twin['input']['raw_query'])}"
    (project_dir / "preview.html").write_text(
        f'<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="refresh" content="0; url={html.escape(target)}"><a href="{html.escape(target)}">3D live preview 열기</a></html>',
        encoding="utf-8",
    )
    base = f"/generated/{twin['project_id']}"
    return {
        "preview": f"{base}/preview.html",
        "manifest": f"{base}/source_manifest.json",
        "qa": f"{base}/qa_report.html",
        "data": f"{base}/twin.json",
    }


def call_ollama(query: str, twin: dict[str, Any], manifest: dict[str, Any]) -> tuple[bool, str]:
    geocoding_provider = str(manifest.get("geocoding", {}).get("provider", "fallback"))
    geocoding_confidence = str(manifest.get("geocoding", {}).get("confidence", "low"))
    prompt = f"""
너는 한국 주소 기반 디지털 트윈 프리뷰 파이프라인 에이전트다.
사용자 요청: {query}
프로젝트: {twin.get("project_id")}
주소 후보: {twin.get("addresses")}
지오코딩 상태/신뢰도: {geocoding_display(geocoding_provider)} / {geocoding_confidence}

짧은 한국어로 답하라.
반드시 다음을 분리해서 말하라:
1. 지금 생성 가능한 preview 결과
2. 근사/추정인 것
3. 공식 데이터가 필요한 것
4. 다음 액션
측량급/법적 효력이 있다고 주장하지 마라.
사용자에게 내부 provider 코드명인 fallback을 그대로 노출하지 말고 공식 GIS 미연결이라고 표현하라.
"""
    payload = {
        "model": GEMMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 220},
    }
    request = urllib.request.Request(
        f"{OLLAMA_URL.rstrip('/')}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
            text = str(body.get("response", "")).strip()
            return True, text or "Gemma 응답이 비어 있습니다. 로컬 규칙 기반 설명으로 대체합니다."
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return False, f"Gemma/Ollama 응답을 가져오지 못했습니다: {exc}"


def build_agent_run(query: str) -> dict[str, Any]:
    clean = query.strip() or "사당동 317-6번지 디지털 트윈 만들어줘"
    intent = infer_intent(clean)
    geocoding = geocode_address(clean)
    twin = build_twin(clean, geocoding)
    manifest = build_manifest(twin)
    links = persist_project(twin, manifest)
    model_ok, model_text = call_ollama(clean, twin, manifest)
    address = twin["addresses"]

    return {
        "query": clean,
        "recognizedAddress": f"{address['parcel_address']} / {address['road_address_candidate']}",
        "intent": intent,
        "confidence": geocoding["confidence"],
        "model": {"provider": "ollama", "name": GEMMA_MODEL, "available": model_ok},
        "messages": [
            {"role": "user", "text": clean},
            {
                "role": "agent",
                "text": f"주소 후보를 {address['parcel_address']} / {address['road_address_candidate']}로 정리했습니다. 3D 프리뷰 씬과 manifest를 이 주소 기준으로 갱신합니다.",
            },
            {"role": "agent", "text": model_text},
        ],
        "steps": [
            {"label": "1. 주소 의도 해석", "status": "done", "detail": "입력 주소를 동적 프로젝트로 변환"},
            {
                "label": "2. 좌표 후보 선택",
                "status": "warning" if geocoding["confidence"] == "low" else "done",
                "detail": f"공간 데이터 {geocoding_display(geocoding['provider'])} / confidence {geocoding['confidence']}",
            },
            {"label": "3. 프리뷰 geometry 생성", "status": "done", "detail": "대상 건물, 주변 매스, 도로 힌트, 필지 경계 생성"},
            {"label": "4. Gemma 검토", "status": "done" if model_ok else "warning", "detail": "Gemma 응답 포함" if model_ok else "Ollama/Gemma unavailable"},
            {"label": "5. 공식 데이터 업그레이드", "status": "next", "detail": "VWorld/Juso/PNU/건물통합정보 연결 후 official geometry로 교체"},
        ],
        "outputLinks": [
            {"label": "3D live preview", "href": links["preview"], "kind": "preview"},
            {"label": "source_manifest.json", "href": links["manifest"], "kind": "manifest"},
            {"label": "qa_report.html", "href": links["qa"], "kind": "qa"},
            {"label": "twin.json", "href": links["data"], "kind": "data"},
        ],
        "twin": twin,
        "manifest": manifest,
    }


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(DIST), **kwargs)

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/healthz":
            self.send_json(
                {
                    "ok": True,
                    "model": GEMMA_MODEL,
                    "juso": bool(os.environ.get("JUSO_API_KEY") or os.environ.get("JUSO_CONFIRM_KEY")),
                    "vworld": bool(os.environ.get("VWORLD_API_KEY")),
                }
            )
            return
        tile_match = re.fullmatch(
            r"/api/vworld/wmts/(Base|gray|midnight|white|Hybrid|Satellite)/(\d+)/(\d+)/(\d+)\.(png|jpe?g)",
            path,
        )
        if tile_match:
            layer, z_raw, y_raw, x_raw, ext = tile_match.groups()
            tile = fetch_vworld_wmts_tile(layer, int(z_raw), int(y_raw), int(x_raw), ext)
            if tile is None:
                self.send_error(404, "VWorld WMTS tile unavailable")
                return
            body, content_type = tile
            self.send_binary(body, content_type)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/agent":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw or "{}")
            query = str(payload.get("query", ""))
            self.send_json(build_agent_run(query))
        except Exception as exc:  # noqa: BLE001 - deployment server should return readable JSON.
            self.send_json({"error": str(exc)}, status=500)

    def end_headers(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/generated/") and path.endswith((".json", ".html")):
            self.send_header("Cache-Control", "no-store")
            self.send_header("Pragma", "no-cache")
        if path.endswith((".json", ".html", ".js", ".css")):
            self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_binary(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    if not DIST.exists():
        raise SystemExit(f"Missing dist directory: {DIST}")
    GENERATED.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving {DIST} on http://{HOST}:{PORT} with {GEMMA_MODEL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
