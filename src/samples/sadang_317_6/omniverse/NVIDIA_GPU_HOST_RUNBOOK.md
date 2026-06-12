# NVIDIA GPU Host Runbook — sadang_317_6

This handoff is for the NVIDIA-only runtime path. The local package can author and validate OpenUSD, but final visual acceptance must come from NVIDIA Omniverse / RTX / ovrtx, not the browser WebGL MVP.

## Package state

- Source confidence: high
- Local preflight status: openusd_ready
- OpenUSD stage: `sadang_317_6.usda`
- ovrtx viewer wrapper: `sadang_317_6.ovrtx_viewer.usda`
- ovrtx first-frame smoke: `nvidia_ovrtx_first_frame.py`
- ovstream readiness smoke: `nvidia_ovstream_smoke_server.py`
- Local authoring evidence: `usdchecker_report.txt`
- SimReady baseline: `simready_minimum_report.json` includes USD units/axis/material binding plus conservative static PhysicsCollisionAPI semantics.
- Browser viewer replacement: `ovstream_viewer_contract.json` + `OVSTREAM_VIEWER_RUNBOOK.md` define the NVIDIA-only WebRTC video-stream path.

## 1. Transfer

Copy this folder and the two source files beside it:

```bash
scp -r src/samples/sadang_317_6/omniverse <gpu-host>:/data/sadang_317_6/
scp src/samples/sadang_317_6/twin.json src/samples/sadang_317_6/source_manifest.json <gpu-host>:/data/sadang_317_6/
```

## 2. GPU host smoke gates

Run on the NVIDIA machine:

```bash
cd /data/sadang_317_6/omniverse
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
usdchecker sadang_317_6.usda
export OVRTX_SKIP_USD_CHECK=1
python3 nvidia_ovrtx_first_frame.py --stage sadang_317_6.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm
python3 nvidia_ovstream_smoke_server.py --stage sadang_317_6.ovrtx_viewer.usda --output-json ovstream_smoke_report.json
```

If running from the full repository checkout, also run:

```bash
npm ci
npm run nvidia:preflight
```

Acceptance threshold: `nvidia_runtime_preflight.json` should move from `openusd_ready` to `nvidia_runtime_ready` before claiming local NVIDIA runtime readiness.

## 3. Omniverse / ovrtx validation

1. Open `sadang_317_6.ovrtx_viewer.usda` in NVIDIA Omniverse, Kit, or ovrtx for the first-frame smoke; open `sadang_317_6.usda` directly for source-stage inspection.
2. Confirm the stage loads with meter units, Y-up axis, official buildings, roads, parcel boundary, terrain reference, flood-water reference layer, materials, and static collider APIs.
3. Follow `OVSTREAM_VIEWER_RUNBOOK.md` to expose browser delivery through ovstream/WebRTC only. The smoke server proves server readiness; browser decode still needs a video first-frame capture.
4. Attach screenshot, stream URL, or render log back to the package.

## 4. SimReady completion gates

This package is only a conservative SimReady candidate. Before saying “full SimReady”:

1. Run Omniverse Content Agents for material and physics assignment.
2. Run Omniverse Asset Validator / SimReady validation.
3. Copy validator reports into this package and update `handoff_manifest.json` checksums.
4. Run USD Performance Tuning if the scene is scaled beyond this MVP sample.

## 5. Do not fake these gates

- Browser Three.js screenshots do not count for NVIDIA-only USD render acceptance.
- Browser-side WebGL/Three.js/Babylon/glTF rendering is forbidden for the NVIDIA-only viewer path; the browser may display only the ovstream video plus UI.
- The static flood-water plane is not an NVIDIA hydrology solve.
- The Mac/local preflight cannot satisfy RTX, ovrtx, NVIDIA Container Toolkit, or Content Agents runtime gates without an NVIDIA GPU host.
