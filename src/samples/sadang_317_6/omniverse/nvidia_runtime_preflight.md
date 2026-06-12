# NVIDIA Runtime Preflight — sadang_317_6

Status: **openusd_ready**

## Summary

- OpenUSD authoring ready: true
- Omniverse RTX ready: false
- Omniverse ovstream/WebRTC ready: false
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
| OMNIVERSE.VIEWER.001 | NVIDIA Omniverse / ovrtx / Kit viewer | blocked | No ovrtx command, ovrtx Python package, kit, usdview, or known Omniverse app path was found. | Install/use an Omniverse Kit or ovrtx runtime on an NVIDIA GPU machine. |
| OMNIVERSE.OVSTREAM.001 | NVIDIA Omniverse Streaming / ovstream WebRTC | blocked | ovstream Python lifecycle check failed and no stream runtime was detected. | Install ovstream on the NVIDIA GPU host and expose OVSTREAM_SIGNALING_URL, OMNIVERSE_STREAM_URL, or OVRTX_WEBRTC_URL after first-frame readiness. |
| CONTENT_AGENTS.AUTH.001 | NVIDIA API / NGC / NVCF credentials | blocked | No NVIDIA_API_KEY, NGC_API_KEY, NVCF_API_KEY, or complete provided Content Agents endpoint set was found. | Provide NVIDIA_API_KEY for local deployment or set provided Content Agents endpoint URLs/tokens. |
| CONTENT_AGENTS.ENDPOINTS.001 | Omniverse Content Agents service endpoints | blocked | material=missing, physics=missing, ovrtx/render=missing | Set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL, CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL, and CONTENT_AGENTS_OVRTX_BASE_URL/OVRTX_RENDER_ENDPOINT, or deploy local Content Agents with NVIDIA_API_KEY. |
| CONTENT_AGENTS.RUNTIME.001 | Omniverse Content Agents | blocked | Content Agents prerequisites are incomplete. | Satisfy NVIDIA GPU + Docker daemon + NVIDIA runtime + auth, or provide healthy service endpoints. |
| SIMREADY.FOUNDATION.001 | NVIDIA SimReady Foundation | passed | SimReady Foundation root exists at /Users/handy_choi/.physical-ai-skill-hub/upstreams/simready-foundation. | - |
| SIMREADY.VALIDATOR.001 | simready-validate | passed | simready-validate CLI is missing, but a Foundation checkout exists for runner-managed installation. | - |

## Next actions

- Move the package to an NVIDIA GPU workstation/cloud VM for RTX/ovrtx rendering.
- Install or expose NVIDIA Omniverse Kit/ovrtx/usdview runtime for the USD stage.
- Install ovstream and validate its Python lifecycle on the NVIDIA GPU host.
- Expose an ovstream/WebRTC endpoint from the NVIDIA GPU host for the browser-delivered NVIDIA-only viewer.
- Configure Content Agents prerequisites: NVIDIA API/NGC/NVCF auth plus GPU Docker runtime, or provided service endpoints.
- Run usdchecker on every exported .usda in CI and keep validator reports with the package.
- After runtime gates pass, run SimReady/Asset Validator and USD Performance Tuning baseline profiling.
