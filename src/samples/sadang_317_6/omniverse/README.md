# sadang_317_6 NVIDIA Omniverse Package

This folder is the NVIDIA-targeted export of the address digital twin. It is authored as OpenUSD for Omniverse/RTX workflows; it is not a browser-side Three.js runtime.

## Files

- `sadang_317_6.usda` — OpenUSD ASCII stage with official building, road, parcel, terrain-reference, and flood-water layer prims.
- `nvidia_stack_manifest.json` — product mapping and runtime gate status.
- `nvidia_runtime_preflight.json` / `.md` — local NVIDIA/Omniverse/SimReady runtime gate probe.
- `simready_minimum_report.json` — minimum SimReady-candidate checks and blocked external gates.
- `usdchecker_report.txt` — local USD checker output when `usdchecker` is available.

## Local runtime probe

`nvidia-smi`: missing
`docker`: available
`python pxr`: missing
`usdchecker`: available

No local NVIDIA GPU was detected. This Mac can author OpenUSD deterministically, but RTX/ovrtx rendering and SimReady runtime validation must run on an NVIDIA workstation/container.

## Intended NVIDIA flow

1. Open `sadang_317_6.usda` with NVIDIA Omniverse / ovrtx.
2. Run Omniverse Asset Validator and SimReady validation.
3. Run Omniverse Content Agents for material and physics assignment when a GPU/Docker/NVIDIA_API_KEY runtime is available.
4. Use Omniverse USD Performance Tuning for large scene profiling and optimization.
5. Add cuOpt only for operational routing/dispatch optimization; add NuRec only when camera/LiDAR captures exist.
