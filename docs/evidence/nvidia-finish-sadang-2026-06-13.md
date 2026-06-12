# NVIDIA finish report

Status: **blocked**

- Project: `sadang_317_6`
- Scratch dir: `.tmp/nvidia-finish`
- Persist intermediate evidence: `False`
- Secret handling: No secret values are printed; child commands receive environment only.

## Steps

| Step | Status | Exit |
| --- | --- | --- |
| `content-agents-deploy-plan` | `passed` | `0` |
| `content-agents-deploy-status` | `passed` | `0` |
| `content-agents-run` | `skipped` | `` |
| `simready-validate` | `skipped` | `` |
| `nvidia-acceptance` | `passed` | `0` |

## Blockers

- Content Agents endpoints are not ready and NVIDIA_API_KEY/NVIDIA_API_KEY_FILE is not present for automatic deployment.
- Content Agents endpoints are not ready; skipping Material→Physics assignment instead of calling dead generated endpoints.
- status=blocked, blockers=['NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.'], gpu_assignment={'policy': 'auto_multi_gpu_split', 'detected_gpu_count': 8, 'material_ovrtx_visible_devices': '0', 'physics_ovrtx_visible_devices': '1'}, endpoint_env=.tmp/nvidia-content-agents/endpoints.env
- status=blocked, blockers=['Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.', 'Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.', 'Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.']

## Next commands

- `NVIDIA_API_KEY_FILE=/secure/path/nvidia_api_key npm run nvidia:finish`
- `npm run nvidia:acceptance`
