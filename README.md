# Address-to-Digital-Twin Preview MVP

[![CI](https://github.com/VincentChoi33/address-to-digital-twin-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/VincentChoi33/address-to-digital-twin-mvp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Zero-cash-cost MVP that turns a Korean address into a browser-viewable 3D digital twin preview — and then runs an interactive **urban flood (hydrology) simulation** on top of it. Built with TypeScript, Three.js, and Vite; no paid APIs required.

![Web app: LLM address console (left) and generated 3D twin scene (right)](docs/images/app-screenshot.png)

*The local web app: a Korean-address LLM console and hydrology dashboard on the left, and the generated scene on the right — satellite-textured ground, building massing, parcel boundary, road hints, with per-layer toggles and a source legend.*

| Static preview export (Sadang sample) | Generated QA / confidence report |
| :---: | :---: |
| ![Static 3D preview of the Sadang sample twin](docs/images/twin-preview-sadang.png) | ![Auto-generated QA and confidence report](docs/images/twin-qa-report-sadang.png) |

## What it does

The project has two cooperating layers:

**1. Address → twin pipeline** (`src/pipeline/`)

- Normalizes a raw Korean address request into parcel / road / building-name candidates.
- Geocodes through a graceful fallback chain: Juso → VWorld → Nominatim → deterministic offline coordinates.
- Generates approximate target-building massing, surrounding context massing (OSM/Overpass best-effort, procedural fallback), parcel boundary, and road hints.
- Emits four artifacts per address: `twin.json`, `source_manifest.json` (per-layer source + confidence), a human-readable `qa_report.html`, and a standalone `preview.html` (CDN Three.js, opens directly in a browser).

**2. Interactive viewer + flood simulator** (`src/app/`)

- Three.js scene with orbit/orthographic cameras, satellite/X-ray/shadow toggles, and per-layer confidence display.
- A 24×24 cell shallow-water gravity-routing simulation layered on the twin: rainfall intensity control, surface runoff, sewer inlets, underground pipe network, outfalls, and subway-entrance inundation.
- Disaster scenario presets (2022 Gangnam flood, doubled sewer capacity, deep drainage tunnel), a city-editor toolbar (pave roads, place buildings/sewers/pipes, raise/lower terrain), live hydrograph chart, gauges, and synthesized sound effects via the Web Audio API.
- An LLM-style address console: a deterministic local rule agent works fully offline; in deployment, `/api/agent` can call an Ollama-compatible Gemma endpoint (`gemma3:4b` by default) and falls back to the local agent if the model service is unavailable.

> **Not** a survey-grade, cadastral, legal, BIM, or legally authoritative digital twin. Official PNU/parcel/building geometry must replace the preview massing before any production or decision-grade use.

## Quick start

```bash
npm install
npm run sample:sadang   # generate the Sadang sample artifacts
npm run dev             # open the printed Vite URL
```

In the app, try prompts such as:

```text
사당동 317-6번지 디지털 트윈 만들어줘
서울 동작구 사당로20가길 39 공식 디지털 트윈 만들어줘
서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘
```

Or generate a twin for any address from the CLI:

```bash
npx tsx src/pipeline/runAddressTwin.ts --address "서울 강남구 테헤란로 152"
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | local web app (Vite) |
| `npm run build` | typecheck + production build |
| `npm test` | unit tests (Vitest) |
| `npm run lint` | TypeScript check |
| `npm run sample:sadang` | generate Sadang sample artifacts |
| `npm run prepare:deploy` | build `dist/` and copy generated samples for deployment |

Open `src/samples/sadang_317_6/preview.html` directly in a browser for the static Three.js export.

## Project structure

```text
src/
  pipeline/          # address → twin generation (runs in Node via tsx)
    geocode.ts       # Juso/VWorld/Nominatim/offline fallback chain
    dataConnectors.ts# Overpass/OSM context, lon-lat → local meters
    generateMassing.ts# target + context massing, roads, parcel boundary
    manifest.ts      # per-layer source/confidence manifest
    qa.ts            # human-readable QA/confidence report (HTML)
    exportStaticHtml.ts# standalone preview.html export
    runAddressTwin.ts# CLI entry point
  app/               # browser app (Vite)
    main.ts          # bootstrap + UI bindings
    ui.ts            # DOM layout + Korean label helpers
    agent.ts         # deterministic local address agent
    viewer.ts        # Three.js scene + shallow-water flood simulation
  types/twin.ts      # shared twin/manifest/hydrology types
  samples/           # committed sample artifacts (Sadang 317-6)
deploy/
  server.py          # zero-dependency static + /api/agent (Ollama/Gemma) server
  batch_address_qa.py# repeatable address QA batch runner
```

## Deployment with a local model server

`deploy/server.py` serves the built app and exposes `/api/agent`. It calls an Ollama-compatible Gemma endpoint (`GEMMA_MODEL=gemma3:4b` by default) and falls back to a readable warning if the model service is unavailable.

```bash
npm run prepare:deploy
python3 deploy/server.py        # HOST/PORT/OLLAMA_URL/GEMMA_MODEL via env or .env
```

On a deployed server with `.env` keys configured, run a repeatable address QA batch:

```bash
python3 deploy/batch_address_qa.py addresses.txt --project-id address_batch_20260427
```

## Optional environment

The MVP runs without any API keys by falling back to Nominatim for occasional manual testing and then deterministic procedural coordinates when network geocoding is unavailable.

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `VWORLD_API_KEY` | VWorld geocoder + WMTS satellite tiles (key stays server-side; summary only is persisted) |
| `JUSO_API_KEY` | Juso address normalization (summary only is persisted) |
| `NOMINATIM_USER_AGENT` | occasional manual fallback tests only, not bulk geocoding |
| `VITE_BASEMAP_MODE` | empty (default) \| `procedural` \| `vworld` \| `arcgis` \| `custom` |
| `VITE_CUSTOM_TILE_URL` | e.g. `https://host/{z}/{x}/{y}.png` |

When `VWORLD_API_KEY` is configured on the deployment server, the browser defaults to VWorld satellite preview tiles through `/api/vworld/wmts/Satellite/{z}/{y}/{x}.jpeg`. Tiles are requested live and never cached or persisted.

## Spatial alignment principle

The preview treats Juso/VWorld geocoding as a search hint, not as the final world origin:

1. Normalize/search the address with Juso/VWorld.
2. Use the search coordinate only to fetch candidate WFS parcel, building, and road geometry.
3. When official WFS parcel geometry is found, re-anchor the local 3D meter frame to the official parcel centroid.
4. If a parcel is unavailable but official building geometry exists, anchor to the building footprint centroid.
5. Drape VWorld WMTS satellite imagery onto that cadastral/WFS frame as a live visual texture.

Parcel/building WFS geometry is the alignment authority. Satellite imagery is texture/context only — the MVP never infers legal parcel or building geometry from imagery.

## Data source policy

- Default fallback ground is a fully offline procedural grid.
- VWorld WMTS satellite is the preferred Korean basemap preview when configured; the app proxies live tiles without exposing the key or caching imagery.
- ArcGIS World Imagery is optional preview-only live tile display with visible attribution and no caching.
- Custom tile URLs must be checked against the provider terms.
- Juso/VWorld responses are never persisted raw; only derived summaries land in `source_manifest.json`.
- Nominatim is used only for occasional manual preview fallback, with a custom User-Agent and 1 request/sec behavior.
- Overpass/OSM context is best-effort only; on failure, procedural surrounding buildings and road hints are generated.
- Overture Maps is intentionally a future connector placeholder; this MVP downloads no Overture datasets.

## Bundled sample

Offline Sadang approximation (`src/samples/sadang_317_6/`):

- Parcel address: `서울 동작구 사당동 317-6` / road candidate: `서울 동작구 사당로20가길 39`
- Approximate coordinate: `37.48420, 126.96975`, confidence `low`

The manifest explicitly marks approximate layers, and the QA report explains what requires official verification.

## Testing & CI

Unit tests (Vitest) cover the deterministic core: address candidate normalization, the local agent, massing generation, manifest/QA report building, and coordinate math. GitHub Actions runs typecheck → tests → build → an offline sample-pipeline smoke on every push and PR.

```bash
npm test
```

## Upgrade path

1. Juso normalization: normalize parcel/road address and reduce ambiguity.
2. VWorld geocoding: raise coordinate confidence and record selected candidate summary.
3. Parcel boundary: resolve PNU and fetch official cadastral geometry.
4. GIS building integrated info: replace fallback massing with official footprint, floors, height, use, and registry attributes.
5. AI3DAP/SolidRecon adapter: generate higher-detail roof/mesh/texture geometry from official inputs and imagery.
6. 3D Tiles/Cesium export: stream official LOD1/LOD2 outputs for web-scale city viewing.
7. QA/confidence dashboard: compare official sources, flag mismatches, and separate preview/official deliverables.

## License

[MIT](LICENSE)
