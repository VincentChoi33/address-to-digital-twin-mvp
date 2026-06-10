# Address-to-Digital-Twin Preview MVP

Zero-cash-cost MVP for turning a Korean address into a browser-viewable 3D digital twin preview.

This MVP creates a fast visual preview: procedural/offline ground, optional live satellite texture, approximate target building massing, surrounding context massing, approximate parcel boundary, road hints, POI markers, `source_manifest.json`, and a human-readable QA report.

The local web app also includes an LLM-style address request console. It does not require a paid LLM API: a deterministic local agent parses Korean address requests, separates preview outputs from official-data-required work, and links the generated preview/manifest/QA artifacts. In deployment, `/api/agent` can generate a fresh preview for arbitrary Korean address text and return `twin` + `manifest` JSON for the browser to render immediately.

For deployment with a local model server, `deploy/server.py` serves the built app and exposes `/api/agent`. It calls an Ollama-compatible Gemma endpoint with `GEMMA_MODEL=gemma3:4b` by default and falls back to a readable warning if the model service is unavailable.

It is not a survey-grade, cadastral, legal, BIM, or legally authoritative digital twin. Juso/VWorld can improve address normalization and coordinates, but official PNU/parcel/building geometry must still replace the preview massing before any production or decision-grade use.

## Setup

```bash
cd mvp
npm install
npm run sample:sadang
npm run dev
npm run prepare:deploy
```

Open the local Vite URL printed by `npm run dev`.

In the app, try prompts such as:

```text
사당동 317-6번지 디지털 트윈 만들어줘
서울 동작구 사당로20가길 39 공식 디지털 트윈 만들어줘
서울 강남구 테헤란로 152 디지털 트윈 프리뷰 만들어줘
```

## Commands

```bash
npm run dev             # local web app
npm run build           # typecheck + production build
npm run sample:sadang   # generate Sadang sample artifacts
npm run export:sadang   # regenerate static preview.html
npm run prepare:deploy   # build dist and copy generated samples for deployment
npm run lint            # TypeScript check
```

On a deployed server with `.env` keys configured, run a repeatable address QA batch:

```bash
python3 deploy/batch_address_qa.py addresses.txt --project-id address_batch_20260427
```

Generated sample:

```text
src/samples/sadang_317_6/
  twin.json
  source_manifest.json
  qa_report.html
  preview.html
```

Open `src/samples/sadang_317_6/preview.html` directly in a browser for the static Three.js export. The static export uses CDN-hosted Three.js like the existing reference HTML examples; the local Vite app uses installed npm packages.

## Optional Environment

The MVP runs without API keys by falling back to Nominatim for occasional manual testing and then deterministic procedural coordinates when network geocoding is unavailable.

```bash
cp .env.example .env
```

Optional values:

```text
VWORLD_API_KEY=...                 # VWorld geocoder summary only; raw response is not persisted
JUSO_API_KEY=...                   # Juso address normalization summary only; raw response is not persisted
NOMINATIM_USER_AGENT=...           # occasional manual fallback tests only, not bulk geocoding
VITE_BASEMAP_MODE=                 # empty(default vworld) | procedural | vworld | arcgis | custom
VITE_CUSTOM_TILE_URL=...           # e.g. https://host/{z}/{x}/{y}.png
```

When `VWORLD_API_KEY` is configured on the deployment server, the browser defaults to VWorld satellite preview tiles through `/api/vworld/wmts/Satellite/{z}/{y}/{x}.jpeg`. The key stays server-side, tiles are requested live, and the MVP does not cache or persist imagery.

## Spatial Alignment Principle

The preview treats Juso/VWorld geocoding as a search hint, not as the final world origin.

1. Normalize/search the address with Juso/VWorld.
2. Use the search coordinate only to fetch candidate WFS parcel, building, and road geometry.
3. When official WFS parcel geometry is found, re-anchor the local 3D meter frame to the official parcel centroid.
4. If a parcel is unavailable but official building geometry exists, anchor to the building footprint centroid.
5. Render VWorld WMTS satellite imagery as a live visual texture draped onto that cadastral/WFS frame.

In other words, parcel/building WFS geometry is the alignment authority. Satellite imagery is useful texture/context, but the MVP does not infer legal parcel or building geometry from imagery.

## Data Source Policy

- Default fallback ground is a fully offline procedural grid.
- VWorld WMTS satellite is the preferred Korean basemap preview when `VWORLD_API_KEY` is configured; the app proxies live tiles without exposing the key or caching imagery.
- ArcGIS World Imagery is optional preview-only live tile display with visible attribution and no caching.
- Custom tile URL is optional and must be checked against the provider terms.
- Juso search API is optional via `JUSO_API_KEY`; the MVP stores only derived road/parcel/building-name summary in `source_manifest.json`.
- VWorld geocoder is optional via `VWORLD_API_KEY`; the MVP stores only a derived coordinate summary in `source_manifest.json`.
- Nominatim is used only for occasional manual preview fallback, with a custom User-Agent and 1 request/sec behavior.
- Overpass/OSM context is best-effort only; if it fails, procedural surrounding buildings and road hints are generated.
- Overture Maps is intentionally a future connector placeholder. Do not download large Overture datasets in this MVP.

## Current Fallback Sample

Fallback Sadang approximation:

- Parcel address: `서울 동작구 사당동 317-6`
- Road-address candidate: `서울 동작구 사당로20가길 39`
- Building-name candidate: `행복이가득한집`
- Approximate coordinate: `37.48420, 126.96975`
- Confidence: `low`

The manifest explicitly marks approximate layers and the QA report explains what requires official verification.

## Existing Reference HTML

These files remain untouched and are referenced as design/proposal background:

- `../reference/sadang_317_6_satellite_digital_twin_v02.html`
- `../reference/sadang_317_6_digital_twin_v01.html`
- `../reference/agentic_spatial_twin_technical_deep_dive.html`
- `../reference/agentic_spatial_twin_easy_explainer.html`
- `../reference/agenticai-digital-twin-onepager_applied_sadang3176.html`
- `../reference/address_twin_mvp_upgrade_report.html`

## Upgrade Path

1. Juso normalization: normalize parcel/road address and reduce ambiguity.
2. VWorld geocoding: raise coordinate confidence and record selected candidate summary.
3. Parcel boundary: resolve PNU and fetch official cadastral geometry.
4. GIS building integrated info: replace fallback massing with official footprint, floors, height, use, and registry attributes.
5. AI3DAP/SolidRecon adapter: generate higher-detail roof/mesh/texture geometry from official inputs and imagery.
6. 3D Tiles/Cesium export: stream official LOD1/LOD2 outputs for web-scale city viewing.
7. QA/confidence dashboard: compare official sources, flag mismatches, and separate preview/official deliverables.
