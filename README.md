# Address → Digital Twin · Flood Simulator

[![CI](https://github.com/VincentChoi33/address-to-digital-twin-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/VincentChoi33/address-to-digital-twin-mvp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Type a Korean address, get a browser-viewable 3D digital twin preview, then run an interactive **urban flood simulation on that twin's buildings and roads**. Zero cash cost: no paid APIs, fully offline-capable. TypeScript + Three.js + Vite.

**One flow, end to end:** `주소 → 지오코딩(폴백 체인) → 절차적 매싱 → 24×24 수문 격자 래스터화 → 침수 시뮬레이션`. Any address works — out-of-sample addresses get a deterministic offline preview twin generated **client-side**, so the full twin → flood loop runs without a single API key.

![Web app](docs/images/app-screenshot.png)

| Static preview export (Sadang sample) | Generated QA / confidence report |
| :---: | :---: |
| ![Static 3D preview](docs/images/twin-preview-sadang.png) | ![QA report](docs/images/twin-qa-report-sadang.png) |

## What it does

**1. Address → twin pipeline** (`src/core/`, runs in Node and in the browser)

- Normalizes a raw Korean address request into parcel / road / building-name candidates.
- Geocodes through a graceful fallback chain: Juso → VWorld → Nominatim → deterministic offline coordinates (Node CLI), or straight to the offline path in the browser.
- Generates target massing, surrounding context (OSM/Overpass best-effort, seeded procedural fallback), parcel boundary, and road hints.
- Emits four artifacts: `twin.json`, `source_manifest.json` (per-layer source + confidence), human-readable `qa_report.html`, standalone `preview.html`. In the web app these download as generated blobs for any address.

**2. Hydrology engine** (`src/sim/` — pure TypeScript, no Three.js, fully unit-tested)

- Rasterizes the twin's buildings/roads into a 24×24 cell grid: seeded terrain slope, sewer inlets along roads, a capacity-limited outfall, underground-space entrances near the target.
- Shallow-water gravity routing, roof runoff, sewer intake, pipe migration toward the outfall, manhole backflow when the network saturates, underground inundation alarm.
- Deterministic: same twin in, same simulation out. Stylized demo physics (rainfall is amplified for visible flooding), not SWMM.

**3. Viewer + UI** (`src/render/`, `src/app/`)

- Three.js instanced-mesh city (1 draw call per layer), live satellite drape (ArcGIS/VWorld tile mosaic sampled onto terrain cells), twin massing overlay, orbit/top views, X-ray, shadows, dark/light theme.
- Disaster scenario presets (극한폭우 140mm/h, 하수도 2배 확장, 대심도 배수터널), rainfall slider, city-editor tools (pave roads, build, place sewers/pipes/outfalls, raise/lower terrain), cell inspector, gauges, rolling hydrograph, synthesized sound (Web Audio).
- **Graceful degradation:** if WebGL is unavailable the app keeps running in console mode — address analysis and artifact downloads still work, with a clear banner instead of a dead page.
- LLM-style console: a deterministic local rule agent works fully offline; in deployment `/api/agent` can call an Ollama-compatible Gemma endpoint and the client falls back to the local agent when the server is absent.

> **Not** a survey-grade, cadastral, legal, BIM, or legally authoritative digital twin. Official PNU/parcel/building geometry must replace the preview massing before any production or decision-grade use.

## Quick start

```bash
npm install
npm run dev     # open the printed URL
```

Try any Korean address in the console:

```text
사당동 317-6번지 디지털 트윈 만들어줘          # curated sample
서울 강남구 테헤란로 152 디지털 트윈 프리뷰    # generated offline, on the spot
부산 해운대구 우동 1408                        # also works — different terrain, same flow
```

Then hit **극한폭우 (140mm/h)** and watch the twin flood: streets pond, pipes pressurize, manholes back up red, and the underground-entrance alarm fires.

CLI generation (adds Juso/VWorld/Nominatim/Overpass when keys/network exist):

```bash
npx tsx src/core/runAddressTwin.ts --address "서울 강남구 테헤란로 152"
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | local web app (Vite) |
| `npm run build` | typecheck + production build |
| `npm test` | unit tests (Vitest) |
| `npm run lint` | TypeScript check |
| `npm run sample:sadang` | regenerate Sadang sample artifacts |
| `npm run prepare:deploy` | build `dist/` + copy samples for deployment |

## Project structure

```text
src/
  core/              # address → twin generation (Node + browser-safe)
    address.ts       #   pure address parsing + deterministic fallback coords
    geocode.ts       #   Juso/VWorld/Nominatim chain (Node CLI)
    previewTwin.ts   #   client-side offline twin generation
    generateMassing.ts, manifest.ts, qa.ts, exportStaticHtml.ts
    runAddressTwin.ts#   CLI entry point
  sim/
    hydrology.ts     # pure flood engine: rasterize twin → step → tools/scenarios
  render/
    scene.ts         # Three.js instanced renderer, WebGL-guarded
    basemap.ts       # live tile mosaic (ArcGIS/VWorld/custom), no caching
    sound.ts         # Web Audio synth
  app/
    main.ts, ui.ts   # grid-layout UI shell + bindings
    agent.ts         # deterministic local address agent
  types/twin.ts      # shared twin/manifest types
  samples/           # committed Sadang sample artifacts
deploy/
  server.py          # zero-dependency static + /api/agent (Ollama/Gemma) server
  batch_address_qa.py
```

## Deployment with a local model server

```bash
npm run prepare:deploy
python3 deploy/server.py        # HOST/PORT/OLLAMA_URL/GEMMA_MODEL via env or .env
```

`deploy/server.py` serves the built app and exposes `/api/agent` (Gemma via Ollama, `gemma3:4b` default) plus the VWorld tile proxy. The browser falls back to its local agent whenever the server or model is unavailable.

Batch QA on a deployed server:

```bash
python3 deploy/batch_address_qa.py addresses.txt --project-id address_batch_20260427
```

## Optional environment

Runs with **zero keys** out of the box (offline deterministic coordinates). Keys only raise fidelity:

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `VWORLD_API_KEY` | VWorld geocoder + WMTS satellite tiles (key stays server-side) |
| `JUSO_API_KEY` | Juso address normalization (derived summary only is persisted) |
| `NOMINATIM_USER_AGENT` | occasional manual fallback tests only, not bulk geocoding |
| `VITE_BASEMAP_MODE` | empty(=arcgis) \| `procedural` \| `vworld` \| `arcgis` \| `custom` |
| `VITE_CUSTOM_TILE_URL` | e.g. `https://host/{z}/{x}/{y}.png` |

## Spatial alignment principle

Geocoding is a search hint, not the world origin:

1. Normalize/search the address with Juso/VWorld.
2. Use the search coordinate only to fetch candidate WFS parcel/building/road geometry.
3. When official WFS parcel geometry exists, re-anchor the local meter frame to the official parcel centroid; else to the official building footprint centroid.
4. Satellite imagery is draped as preview texture onto that frame — never used to infer legal geometry.

## Data source policy

- Default ground is fully offline; satellite tiles (VWorld/ArcGIS/custom) are live preview-only with attribution and **no caching or persistence**.
- Juso/VWorld raw responses are never persisted — only derived summaries in `source_manifest.json`.
- Nominatim: occasional manual fallback only, custom User-Agent, 1 req/sec.
- Overpass/OSM context is best-effort; on failure, seeded procedural context is generated.
- Overture Maps remains a future connector placeholder (no dataset downloads).

## Testing & CI

59 Vitest tests cover the deterministic core: address normalization, offline twin generation, massing, manifest/QA building (incl. XSS escaping), and the full hydrology engine (rasterization, downhill flow, sewer/outfall mass balance, manhole backflow, scenario effects, editor tools, determinism). GitHub Actions runs typecheck → tests → build → offline sample smoke on every push/PR.

## Upgrade path

1. Juso/VWorld keys → coordinate confidence.
2. PNU resolution → official cadastral parcel boundary.
3. GIS building integrated info → replace procedural massing with official footprints/heights.
4. DEM-backed terrain for the flood grid (replace seeded slope with real elevation).
5. AI3DAP/SolidRecon adapter → higher-detail roof/mesh/texture geometry.
6. 3D Tiles/Cesium export → web-scale city viewing.

## License

[MIT](LICENSE)
