# sadang_317_6 NVIDIA Omniverse Package

This folder is the NVIDIA-targeted export of the address digital twin. It is authored as OpenUSD for Omniverse/RTX workflows; it is not a browser-side Three.js runtime.

## Files

- `sadang_317_6.usda` — OpenUSD ASCII stage with official building, road, parcel, terrain-reference, and flood-water layer prims.
- `sadang_317_6.ovrtx_viewer.usda` — viewer/session wrapper that sublayers the source stage and adds NVIDIA ovrtx Camera → RenderProduct → RenderVar → RenderSettings wiring.
- `nvidia_ovrtx_first_frame.py` — GPU-host ovrtx smoke script that renders the wrapper through NVIDIA RTX and saves first-frame evidence.
- `nvidia_ovstream_smoke_server.py` — GPU-host smoke server that converts ovrtx `LdrColor` to a persistent BGRA CUDA buffer, starts ovstream WebRTC, and gates `/healthz` on the first converted frame.
- `nvidia_warp_flood_smoke.py` — GPU-host NVIDIA Warp/CUDA shallow-water smoke; writes `warp_flood_report.json` and `warp_flood_depth.pgm` when CUDA/warp-lang are available.
- `ovstream_browser_client/` — NVIDIA `@nvidia/ov-web-rtc` Direct-mode browser client; the browser displays only an HTML video element for the ovstream media track.
- `ovstream_browser_client/scripts/probe-first-frame.mjs` — Playwright probe that clicks Connect, waits for nonzero HTML video dimensions, and saves JSON/screenshot evidence.
- `nvidia_stack_manifest.json` — product mapping and runtime gate status.
- `nvidia_runtime_preflight.json` / `.md` — local NVIDIA/Omniverse/SimReady runtime gate probe.
- `simready_minimum_report.json` — authored SimReady-candidate checks and blocked external Content Agents gates.
- `usdchecker_report.txt` — local USD checker output when `usdchecker` is available.
- `handoff_manifest.json` — SHA-256 file inventory for moving the package to an NVIDIA GPU host.
- `NVIDIA_GPU_HOST_RUNBOOK.md` — concrete GPU-host validation/runbook steps.
- `ovstream_viewer_contract.json` — browser viewer contract: NVIDIA ovrtx/Omniverse server renders, browser displays ovstream WebRTC video only.
- `OVSTREAM_VIEWER_RUNBOOK.md` — GPU-host steps for the browser-delivered NVIDIA-only viewer.

## Local runtime probe

`nvidia-smi`: missing
`docker`: available
`python pxr`: missing
`usdchecker`: available

No local NVIDIA GPU was detected. This Mac can author OpenUSD deterministically, but RTX/ovrtx rendering and SimReady runtime validation must run on an NVIDIA workstation/container.

## Intended NVIDIA flow

1. Open `sadang_317_6.ovrtx_viewer.usda` with NVIDIA Omniverse / ovrtx for first-frame validation, or open `sadang_317_6.usda` directly in Omniverse tools. The source stage already includes a USD PhysicsScene and conservative static collision APIs for terrain/buildings/roads/parcel geometry.
2. Expose browser delivery through ovstream/WebRTC only; browser WebGL/Three.js is not NVIDIA-only acceptance evidence.
3. Run `nvidia_warp_flood_smoke.py` on a CUDA GPU host to create NVIDIA Warp flood simulation evidence for the water layer.
4. Run Omniverse Asset Validator and SimReady validation.
5. Run Omniverse Content Agents for material and physics assignment when a GPU/Docker/NVIDIA_API_KEY runtime is available.
6. Use Omniverse USD Performance Tuning for large scene profiling and optimization.
7. Add cuOpt only for operational routing/dispatch optimization; add NuRec only when camera/LiDAR captures exist.

## GPU-host first-frame smoke

```bash
export OVRTX_SKIP_USD_CHECK=1
python3 nvidia_ovrtx_first_frame.py --stage sadang_317_6.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm
python3 nvidia_ovstream_smoke_server.py --stage sadang_317_6.ovrtx_viewer.usda --output-json ovstream_smoke_report.json
python3 nvidia_warp_flood_smoke.py --stage sadang_317_6.usda --output-json warp_flood_report.json --output-pgm warp_flood_depth.pgm
cd ovstream_browser_client && npm install && npm run build
npm run probe:first-frame -- --url "http://127.0.0.1:5191/?server=127.0.0.1&signalingport=49100"
```
