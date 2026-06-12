# NVIDIA-only acceptance report

Status: **blocked**

- Project: `sadang_317_6`
- Package: `src/samples/sadang_317_6/omniverse`
- Generated: `2026-06-12T19:52:10.062766Z`

## Gates

| Gate | Status | Requirement | Evidence |
| --- | --- | --- | --- |
| `OPENUSD.PACKAGE.001` | `passed` | OpenUSD package, physics/material semantics, and package validation | handoff=ready_for_gpu_host, train1_package_validation=passed, markers_ok=True |
| `VIEWER.NO_WEBGL.001` | `passed` | Browser viewer is NVIDIA ovstream/WebRTC video-only, not client WebGL USD rendering | browser_surface=video_stream_only, forbidden_has_webgl=True, nvidia_client=True |
| `OMNIVERSE.OVRTX_FIRST_FRAME.001` | `passed` | NVIDIA ovrtx produced a real RTX LdrColor first frame on train1 | status=passed, reason=LdrColor frame produced, image=True |
| `OMNIVERSE.OVSTREAM_SERVER.001` | `passed` | NVIDIA ovrtx frame was converted to CUDA BGRA and served via ovstream/WebRTC | status=passed, reason=ovrtx LdrColor converted to persistent BGRA CUDA buffer; ovstream WebRTC server started; /healthz returned 200 only after the converted frame. |
| `OMNIVERSE.OVSTREAM_BROWSER.001` | `passed` | Browser decoded an NVIDIA ov-web-rtc Direct video first frame | status=passed, firstVideoFrame=true, size=1280x720, screenshot=True |
| `NVIDIA.WARP_FLOOD.001` | `passed` | NVIDIA Warp/CUDA shallow-water flood smoke passed on train1 | status=passed, acceptance={'nonzero_water': True, 'max_depth_positive': True, 'flooded_area_gt_10cm': True, 'cuda_device': True}, preview=True |
| `SIMREADY.VALIDATOR.001` | `passed` | NVIDIA SimReady validator passed the self-contained asset-source copy | status=passed, profile=Prop-Robotics-Neutral@1.0.0, validator=2026.4.9 |
| `CONTENT_AGENTS.DEPLOY_READY.001` | `blocked` | Official NVIDIA Content Agents deployment path is ready except for deployment credential | status=blocked, blockers=['NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.'], gpu_assignment={'policy': 'auto_multi_gpu_split', 'detected_gpu_count': 8, 'material_ovrtx_visible_devices': '0', 'physics_ovrtx_visible_devices': '1'}, endpoint_env=.tmp/nvidia-content-agents/endpoints.env |
| `CONTENT_AGENTS.RUNTIME.001` | `blocked` | NVIDIA Content Agents Material→Physics assignment has actually run | status=blocked, blockers=['Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.', 'Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.', 'Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.'] |

## Blockers

- status=blocked, blockers=['NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.'], gpu_assignment={'policy': 'auto_multi_gpu_split', 'detected_gpu_count': 8, 'material_ovrtx_visible_devices': '0', 'physics_ovrtx_visible_devices': '1'}, endpoint_env=.tmp/nvidia-content-agents/endpoints.env
- status=blocked, blockers=['Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.', 'Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.', 'Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.']

## Next commands

- `NVIDIA_API_KEY_FILE=/secure/path/nvidia_api_key npm run nvidia:content-agents:deploy -- up`
- `npm run nvidia:content-agents:deploy:status -- --wait-seconds 900`
- `source .tmp/nvidia-content-agents/endpoints.env`
- `npm run nvidia:content-agents`
- `npm run nvidia:simready`
- `npm run nvidia:acceptance`
