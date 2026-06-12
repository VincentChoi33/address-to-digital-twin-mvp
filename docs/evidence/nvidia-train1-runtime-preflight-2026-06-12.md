# NVIDIA Runtime Preflight — sadang_317_6

Status: **openusd_ready**

## Summary

- OpenUSD authoring ready: true
- Omniverse RTX ready: true
- Omniverse ovstream/WebRTC ready: false
- SimReady automation ready: false
- Content Agents ready: false

## Gates

| Gate | Product | Status | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| OPENUSD.AUTHORING.001 | OpenUSD | passed | The repository authors a meter-based Y-up .usda package from twin.json/source_manifest.json. | - |
| OPENUSD.RUNTIME.001 | OpenUSD / USD Python / usdchecker | passed | pxr-usd-ok | - |
| OPENUSD.CHECKER.001 | usdchecker | warning | usdchecker is missing; export still works but local USD validation cannot run. | Install usdchecker/OpenUSD CLI tools or use Omniverse Kit validation. |
| NVIDIA.GPU.001 | NVIDIA GPU / Driver | passed | NVIDIA GeForce RTX 3090, 580.105.08, 24576 MiB | - |
| DOCKER.001 | Docker | passed | Docker version 29.0.4, build 3247a5a | - |
| DOCKER.DAEMON.001 | Docker daemon | passed | docker info returned runtime metadata. | - |
| DOCKER.NVIDIA_RUNTIME.001 | NVIDIA Container Toolkit | passed | Docker runtime metadata includes nvidia. | - |
| OMNIVERSE.VIEWER.001 | NVIDIA Omniverse / ovrtx / Kit viewer | passed | ovrtx-python-ok 0.3.0 | - |
| OMNIVERSE.OVSTREAM.001 | NVIDIA Omniverse Streaming / ovstream WebRTC | warning | ovstream-python-ok (0, 3, 0); endpoint=missing | Install ovstream on the NVIDIA GPU host and expose OVSTREAM_SIGNALING_URL, OMNIVERSE_STREAM_URL, or OVRTX_WEBRTC_URL after first-frame readiness. |
| CONTENT_AGENTS.AUTH.001 | NVIDIA API / NGC / NVCF credentials | blocked | No NVIDIA_API_KEY, NGC_API_KEY, NVCF_API_KEY, or complete provided Content Agents endpoint set was found. | Provide NVIDIA_API_KEY for local deployment or set provided Content Agents endpoint URLs/tokens. |
| CONTENT_AGENTS.RUNTIME.001 | Omniverse Content Agents | blocked | Content Agents prerequisites are incomplete. | Satisfy NVIDIA GPU + Docker daemon + NVIDIA runtime + auth, or provide healthy service endpoints. |

## Next actions

- Expose an ovstream/WebRTC endpoint from the NVIDIA GPU host for the browser-delivered NVIDIA-only viewer.
- Configure Content Agents prerequisites: NVIDIA API/NGC/NVCF auth plus GPU Docker runtime, or provided service endpoints.
- After runtime gates pass, run SimReady/Asset Validator and USD Performance Tuning baseline profiling.
