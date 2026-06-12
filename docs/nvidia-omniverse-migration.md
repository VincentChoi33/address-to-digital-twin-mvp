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
- `src/nvidia/preflight.ts` and `src/nvidia/runPreflight.ts`
  - Probes the true NVIDIA-only runtime gates: `nvidia-smi`, Docker daemon, NVIDIA Container Toolkit, USD Python/usdchecker, Omniverse/ovrtx/Kit viewer, and Content Agents credentials/endpoints.
  - Writes `nvidia_runtime_preflight.json` and `.md` with redacted environment state and remediation.
- `src/nvidia/handoff.ts` and `src/nvidia/packageHandoff.ts`
  - Writes `handoff_manifest.json` with SHA-256 checksums for the USD package, source `twin.json`, and `source_manifest.json`.
  - Writes `NVIDIA_GPU_HOST_RUNBOOK.md` so a GPU host can reproduce the NVIDIA runtime gates without accepting browser WebGL evidence as a substitute.
- `src/nvidia/viewerContract.ts`
  - Writes `ovstream_viewer_contract.json` and `OVSTREAM_VIEWER_RUNBOOK.md`.
  - Defines the browser replacement path as NVIDIA ovstream/WebRTC video from an Omniverse RTX / ovrtx server. Client-side WebGL/Three.js/Babylon/glTF rendering is explicitly forbidden as final NVIDIA-only acceptance evidence.
- Web app artifact links
  - Every generated twin now exposes `omniverse.usda`, `nvidia_stack_manifest.json`, and `simready_minimum_report.json` as downloadable blobs.

## Generated Sadang package

```text
src/samples/sadang_317_6/omniverse/
  sadang_317_6.usda
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
- GPU-host handoff manifest status is `ready_for_gpu_host` with SHA-256 inventory.
- ovstream viewer contract status is `contract_authored_runtime_gated`: the browser viewer contract is authored, but local NVIDIA GPU/ovrtx/ovstream first-frame validation is not possible on this Mac.
- Runtime preflight status is `openusd_ready`: local OpenUSD/usdchecker and Docker are present, but local NVIDIA GPU, Omniverse/ovrtx/Kit viewer, Content Agents auth/endpoints, and NVIDIA Container Toolkit gates are not ready on this Mac.
- Therefore RTX rendering and full SimReady validation remain external NVIDIA GPU/runtime gates.

## NVIDIA product mapping

| NVIDIA product / stack | Role in this project | Current status |
| --- | --- | --- |
| OpenUSD | Canonical scene interchange replacing ad-hoc browser geometry exports | Implemented |
| NVIDIA Omniverse / RTX Renderer / ovrtx | Final NVIDIA viewer/render path for USD | Runtime-gated; no local NVIDIA GPU |
| NVIDIA ovstream / WebRTC | Browser delivery path for NVIDIA-only viewer; browser displays video stream, not USD geometry | Contract authored; runtime-gated |
| NVIDIA SimReady | Simulation-ready material/physics/profile target | Minimum candidate metadata + static-collider baseline authored; full conformance requires runtime validation |
| Omniverse Content Agents | Material/physics assignment | Planned; requires NVIDIA_API_KEY, Docker, NVIDIA Container Toolkit, GPU or service endpoints |
| Omniverse USD Performance Tuning / Asset Validator / Scene Optimizer | Stage validation, profiling, optimization | `usdchecker` local pass; full Omniverse validator pending |
| NVIDIA cuOpt | Emergency response/inspection/dispatch route optimization | Planned after operational data exists |
| NVIDIA Physical AI Neural Reconstruction / NuRec | Replace preview massing with reconstructed assets from camera/LiDAR/radar recordings | Planned; requires sensor captures |
| NVIDIA AI-Q / NIM / Dynamo | Agentic orchestration and scalable inference around data collection/export/validation | Planned for deployment pipeline, not needed for static USD export |

## Next hard gates for a true NVIDIA-only runtime

1. Run the generated `.usda` on an NVIDIA workstation/container with Omniverse or `ovrtx`.
2. Re-run `npm run nvidia:preflight` on that NVIDIA host until `omniverse_rtx_ready` and `content_agents_ready` become true.
3. Use `handoff_manifest.json` and `NVIDIA_GPU_HOST_RUNBOOK.md` to copy the exact package to the GPU host and attach `nvidia-smi`, `usdchecker`, Omniverse/ovrtx load evidence, and validator reports.
4. Replace the browser-side 3D viewport with an Omniverse/ovstream viewer path. The generated `ovstream_viewer_contract.json` requires an HTML video/WebRTC surface and explicitly forbids substituting browser-side WebGL as the final USD renderer.
5. Run Content Agents material and physics assignment.
6. Run SimReady/Asset Validator gates and persist their reports.
7. Run USD Performance Tuning baseline/after profiling when scene complexity grows.
8. Add cuOpt only when there is real routing/dispatch optimization data.
9. Add NuRec only when camera/LiDAR/radar captures exist.
