# NVIDIA remote finish report

Status: **blocked**

- Host: `train1`
- Remote dir: `/tmp/address-to-digital-twin-mvp-remote-finish-check`
- Branch: `main`
- Dry run: `False`
- Secret handling: Remote script reports only credential presence/absence and never prints NVIDIA_API_KEY values.

## Remote preflight

- Hostname: `gpu1`
- NVIDIA GPU count: `8`
- Docker ready: `True`

### Credential/endpoint presence

| Variable | State |
| --- | --- |
| `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` | `absent` |
| `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` | `absent` |
| `MATERIAL_AGENT_BASE_URL` | `absent` |
| `NVIDIA_API_KEY` | `absent` |
| `NVIDIA_API_KEY_FILE` | `absent` |
| `PHYSICS_AGENT_BASE_URL` | `absent` |

### Health probes

| URL | HTTP status |
| --- | --- |
| `http://127.0.0.1:8100/health` | `0` |
| `http://127.0.0.1:8101/health` | `0` |
| `http://127.0.0.1:8200/health` | `0` |
| `http://127.0.0.1:8201/health` | `0` |

## Steps

| Step | Status | Exit |
| --- | --- | --- |
| `remote-nvidia-finish` | `passed` | `0` |
| `copy-finish-json` | `passed` | `0` |
| `copy-finish-md` | `passed` | `0` |

## Copied evidence

- `finish_json`: `docs/evidence/nvidia-finish-sadang-2026-06-13.json`
- `finish_md`: `docs/evidence/nvidia-finish-sadang-2026-06-13.md`

## Blockers

- Content Agents endpoints are not ready and NVIDIA_API_KEY/NVIDIA_API_KEY_FILE is not present for automatic deployment.
- Content Agents endpoints are not ready; skipping Material→Physics assignment instead of calling dead generated endpoints.
- status=blocked, blockers=['NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.'], gpu_assignment={'policy': 'auto_multi_gpu_split', 'detected_gpu_count': 8, 'material_ovrtx_visible_devices': '0', 'physics_ovrtx_visible_devices': '1'}, endpoint_env=.tmp/nvidia-content-agents/endpoints.env
- status=blocked, blockers=['Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.', 'Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.', 'Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.']

## Next commands

- `npm run nvidia:finish:remote -- --host train1 --remote-nvidia-api-key-file /secure/path/nvidia_api_key`
- `npm run nvidia:finish:remote -- --host train1 --allow-blocked`
