# NVIDIA Runtime Preflight — sadang_317_6

Status: **openusd_ready**

## Summary

- OpenUSD authoring ready: true
- Omniverse RTX ready: false
- SimReady automation ready: false
- Content Agents ready: false

## Gates

| Gate | Product | Status | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| OPENUSD.AUTHORING.001 | OpenUSD | passed | The repository authors a meter-based Y-up .usda package from twin.json/source_manifest.json. | - |
| OPENUSD.RUNTIME.001 | OpenUSD / USD Python / usdchecker | passed | Utility for checking the compliance of a given USD stage or a USDZ package.  Only the first sample of any relevant time-sampled attribute is checked, currently.  General USD checks are always performed, and more restrictive checks targeted at distributable consumer content are also applied when the "--arkit" option is specified. | - |
| OPENUSD.CHECKER.001 | usdchecker | passed | usdchecker is available on PATH. | - |
| NVIDIA.GPU.001 | NVIDIA GPU / Driver | blocked | nvidia-smi is not available or returned non-zero. | Run this package on an NVIDIA workstation, cloud GPU VM, or container host with NVIDIA drivers. |
| DOCKER.001 | Docker | passed | Docker version 29.5.3, build d1c06ef6b4 | - |
| DOCKER.DAEMON.001 | Docker daemon | passed | docker info returned runtime metadata. | - |
| DOCKER.NVIDIA_RUNTIME.001 | NVIDIA Container Toolkit | not_run | Docker runtime metadata did not expose an nvidia runtime. | Install/configure NVIDIA Container Toolkit on the GPU host. |
| OMNIVERSE.VIEWER.001 | NVIDIA Omniverse / ovrtx / Kit viewer | blocked | No ovrtx, kit, usdview, or known Omniverse app path was found. | Install/use an Omniverse Kit or ovrtx runtime on an NVIDIA GPU machine. |
| CONTENT_AGENTS.AUTH.001 | NVIDIA API / NGC / NVCF credentials | blocked | No NVIDIA_API_KEY, NGC_API_KEY, NVCF_API_KEY, or complete provided Content Agents endpoint set was found. | Provide NVIDIA_API_KEY for local deployment or set provided Content Agents endpoint URLs/tokens. |
| CONTENT_AGENTS.RUNTIME.001 | Omniverse Content Agents | blocked | Content Agents prerequisites are incomplete. | Satisfy NVIDIA GPU + Docker daemon + NVIDIA runtime + auth, or provide healthy service endpoints. |

## Next actions

- Move the package to an NVIDIA GPU workstation/cloud VM for RTX/ovrtx rendering.
- Install or expose NVIDIA Omniverse Kit/ovrtx/usdview runtime for the USD stage.
- Configure Content Agents prerequisites: NVIDIA API/NGC/NVCF auth plus GPU Docker runtime, or provided service endpoints.
- Run usdchecker on every exported .usda in CI and keep validator reports with the package.
- After runtime gates pass, run SimReady/Asset Validator and USD Performance Tuning baseline profiling.
