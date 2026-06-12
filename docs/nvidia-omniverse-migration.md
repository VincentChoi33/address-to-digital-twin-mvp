# NVIDIA-only Omniverse migration track

This repository now has a concrete NVIDIA-targeted export path in addition to the browser MVP.
The browser/Three.js viewer remains useful for fast local iteration, but the NVIDIA-only target is:

```text
Juso/VWorld/WFS twin.json
  → OpenUSD stage
  → NVIDIA Omniverse / RTX Renderer / ovrtx viewer
  → SimReady material + physics assignment
  → Omniverse Asset Validator / USD Performance Tuning
  → optional cuOpt / NuRec / AI-Q layers
```

## Implemented in this repo

- `src/nvidia/usd.ts`
  - Converts `TwinProject + SourceManifest` to an OpenUSD ASCII stage.
  - Authors `metersPerUnit = 1`, `upAxis = "Y"`, `defaultPrim`, `UsdPreviewSurface` materials, `MaterialBindingAPI`, a USD `PhysicsScene`, conservative `PhysicsCollisionAPI` static-collider semantics for terrain/buildings/roads/parcel geometry, official building meshes, official road ribbons, parcel boundary ribbon, terrain reference plane, and flood-water reference layer.
- `src/nvidia/exportOmniversePackage.ts`
  - Writes a deterministic package under `src/samples/sadang_317_6/omniverse/`.
  - Probes local NVIDIA/USD runtime gates.
  - Runs `usdchecker` when available and writes `usdchecker_report.txt`.
- `src/nvidia/ovrtxComposite.ts`
  - Generates `sadang_317_6.ovrtx_viewer.usda`, a viewer/session wrapper that sublayers the source OpenUSD stage and adds NVIDIA ovrtx Camera → RenderProduct → RenderVar → RenderSettings wiring.
- `scripts/nvidia_ovrtx_first_frame.py`
  - GPU-host smoke test that uses NVIDIA ovrtx `Renderer(RendererConfig(...))`, steps `/Render/OVServer/ViewportTexture0`, maps `LdrColor`, and saves JSON + image evidence.
- `src/nvidia/preflight.ts` and `src/nvidia/runPreflight.ts`
  - Probes the true NVIDIA-only runtime gates: `nvidia-smi`, Docker daemon, NVIDIA Container Toolkit, USD Python/usdchecker, Omniverse/ovrtx/Kit viewer, and Content Agents credentials/endpoints.
  - Writes `nvidia_runtime_preflight.json` and `.md` with redacted environment state and remediation.
- `src/nvidia/handoff.ts` and `src/nvidia/packageHandoff.ts`
  - Writes `handoff_manifest.json` with SHA-256 checksums for the USD package, source `twin.json`, and `source_manifest.json`.
  - Writes `NVIDIA_GPU_HOST_RUNBOOK.md` so a GPU host can reproduce the NVIDIA runtime gates without accepting browser WebGL evidence as a substitute.
- `src/nvidia/viewerContract.ts`
  - Writes `ovstream_viewer_contract.json` and `OVSTREAM_VIEWER_RUNBOOK.md`.
  - Defines the browser replacement path as NVIDIA ovstream/WebRTC video from an Omniverse RTX / ovrtx server. Client-side WebGL/Three.js/Babylon/glTF rendering is explicitly forbidden as final NVIDIA-only acceptance evidence.
- `src/nvidia/packageValidator.ts` and `src/nvidia/validatePackage.ts`
  - `npm run nvidia:validate` checks the generated package after handoff: SHA-256 inventory, USD units/material/physics semantics, preflight `OMNIVERSE.OVSTREAM.001`, and the viewer no-WebGL contract.
- Web app artifact links
  - Every generated twin now exposes `omniverse.usda`, `nvidia_stack_manifest.json`, and `simready_minimum_report.json` as downloadable blobs.

## Generated Sadang package

```text
src/samples/sadang_317_6/omniverse/
  sadang_317_6.usda
  sadang_317_6.ovrtx_viewer.usda
  nvidia_ovrtx_first_frame.py
  nvidia_stack_manifest.json
  nvidia_runtime_preflight.json
  nvidia_runtime_preflight.md
  simready_minimum_report.json
  handoff_manifest.json
  NVIDIA_GPU_HOST_RUNBOOK.md
  ovstream_viewer_contract.json
  OVSTREAM_VIEWER_RUNBOOK.md
  usdchecker_report.txt
  README.md
```

Current generated evidence:

- 17 official building meshes.
- 8 official road meshes.
- Official parcel boundary ribbon.
- Meter-based Y-up OpenUSD stage.
- USD `PhysicsScene` plus 27 static collision-enabled terrain/building/road/parcel meshes; the flood-water reference plane remains non-colliding.
- Local `usdchecker` exit code 0 (`Validation Result ... Success!`).
- ovrtx wrapper USD validates with local `usdchecker` after adding root `metersPerUnit`, `upAxis`, and `defaultPrim` metadata.
- GPU-host handoff manifest status is `ready_for_gpu_host` with SHA-256 inventory.
- ovstream viewer contract status is `contract_authored_runtime_gated`: the browser viewer contract is authored, but this Mac still cannot run the NVIDIA GPU stream endpoint.
- Local package validator status is `passed` after `npm run nvidia:package`.
- Runtime preflight status is `openusd_ready`: local OpenUSD/usdchecker and Docker are present, but local NVIDIA GPU, Omniverse/ovrtx/Kit viewer, Content Agents auth/endpoints, and NVIDIA Container Toolkit gates are not ready on this Mac.
- RTX first-frame rendering is now proven on `train1`; full ovstream delivery and full SimReady validation remain external NVIDIA runtime gates.

Remote GPU evidence captured on 2026-06-12:

- [`docs/evidence/nvidia-train1-runtime-preflight-2026-06-12.md`](evidence/nvidia-train1-runtime-preflight-2026-06-12.md)
- [`docs/evidence/nvidia-train1-runtime-preflight-2026-06-12.json`](evidence/nvidia-train1-runtime-preflight-2026-06-12.json)
- [`docs/evidence/nvidia-train1-package-validation-2026-06-12.md`](evidence/nvidia-train1-package-validation-2026-06-12.md)
- [`docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.json`](evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.json)
- [`docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png`](evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png)

On `train1` (`gpu1`, 8 × RTX 3090), GPU/driver, Docker, NVIDIA Container Toolkit, OpenUSD Python runtime, Python `ovrtx` runtime, Python `ovstream` lifecycle, `npm run nvidia:package` self-validation, and a real ovrtx first-frame render passed. The first frame used renderer version `(0, 3, 0)`, output `LdrColor` shape `720×1280×4 uint8`, `nonblank_rgb=true`, and step time `115.33351s` on the cold shader-cache run. Remaining remote blockers are explicit: no ovstream/WebRTC endpoint URL and no NVIDIA/NGC/NVCF or Content Agents credentials/endpoints.

![NVIDIA ovrtx first frame from train1](evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png)

## NVIDIA product mapping

| NVIDIA product / stack | Role in this project | Current status |
| --- | --- | --- |
| OpenUSD | Canonical scene interchange replacing ad-hoc browser geometry exports | Implemented |
| NVIDIA Omniverse / RTX Renderer / ovrtx | Final NVIDIA viewer/render path for USD | Implemented wrapper + first-frame smoke; passed on remote RTX 3090 host |
| NVIDIA ovstream / WebRTC | Browser delivery path for NVIDIA-only viewer; browser displays video stream, not USD geometry | Contract authored; runtime-gated |
| NVIDIA SimReady | Simulation-ready material/physics/profile target | Minimum candidate metadata + static-collider baseline authored; full conformance requires runtime validation |
| Omniverse Content Agents | Material/physics assignment | Planned; requires NVIDIA_API_KEY, Docker, NVIDIA Container Toolkit, GPU or service endpoints |
| Omniverse USD Performance Tuning / Asset Validator / Scene Optimizer | Stage validation, profiling, optimization | `usdchecker` local pass; full Omniverse validator pending |
| NVIDIA cuOpt | Emergency response/inspection/dispatch route optimization | Planned after operational data exists |
| NVIDIA Physical AI Neural Reconstruction / NuRec | Replace preview massing with reconstructed assets from camera/LiDAR/radar recordings | Planned; requires sensor captures |
| NVIDIA AI-Q / NIM / Dynamo | Agentic orchestration and scalable inference around data collection/export/validation | Planned for deployment pipeline, not needed for static USD export |

## Next hard gates for a true NVIDIA-only runtime

1. Expose an ovstream/WebRTC endpoint from the NVIDIA GPU host and attach browser video first-frame evidence.
2. Re-run `npm run nvidia:preflight` on that NVIDIA host until `omniverse_streaming_ready` and `content_agents_ready` become true.
3. Use `handoff_manifest.json` and `NVIDIA_GPU_HOST_RUNBOOK.md` to keep the exact package checksums, `nvidia-smi`, `usdchecker`, ovrtx first-frame report/image, and validator reports together.
4. Replace the browser-side 3D viewport with an Omniverse/ovstream viewer path. The generated `ovstream_viewer_contract.json` requires an HTML video/WebRTC surface and explicitly forbids substituting browser-side WebGL as the final USD renderer.
5. Run Content Agents material and physics assignment.
6. Run SimReady/Asset Validator gates and persist their reports.
7. Run USD Performance Tuning baseline/after profiling when scene complexity grows.
8. Add cuOpt only when there is real routing/dispatch optimization data.
9. Add NuRec only when camera/LiDAR/radar captures exist.
