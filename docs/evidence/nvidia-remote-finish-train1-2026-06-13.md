# NVIDIA remote finish report

Status: **passed**

- Host: `train1`
- Remote dir: `~/workspace/personal/address-to-digital-twin-mvp`
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
| `NVIDIA_API_KEY_FILE` | `present` |
| `PHYSICS_AGENT_BASE_URL` | `absent` |

### Health probes

| URL | HTTP status |
| --- | --- |
| `http://127.0.0.1:8100/health` | `200` |
| `http://127.0.0.1:8101/health` | `200` |
| `http://127.0.0.1:8200/health` | `200` |
| `http://127.0.0.1:8201/health` | `200` |

## Steps

| Step | Status | Exit |
| --- | --- | --- |
| `remote-nvidia-finish` | `passed` | `0` |
| `copy-finish-json` | `passed` | `0` |
| `copy-finish-md` | `passed` | `0` |
| `copy-nvidia-content-agents-deploy-plan-sadang-2026-06-13.json` | `passed` | `0` |
| `copy-nvidia-content-agents-deploy-plan-sadang-2026-06-13.md` | `passed` | `0` |
| `copy-nvidia-content-agents-deploy-status-sadang-2026-06-13.json` | `passed` | `0` |
| `copy-nvidia-content-agents-deploy-status-sadang-2026-06-13.md` | `passed` | `0` |
| `copy-nvidia-content-agents-run-sadang-2026-06-12.json` | `passed` | `0` |
| `copy-nvidia-content-agents-run-sadang-2026-06-12.md` | `passed` | `0` |
| `copy-nvidia-only-acceptance-sadang-2026-06-13.json` | `passed` | `0` |
| `copy-nvidia-only-acceptance-sadang-2026-06-13.md` | `passed` | `0` |
| `copy-nvidia-simready-validate-sadang-2026-06-12.json` | `passed` | `0` |
| `copy-nvidia-simready-validate-sadang-2026-06-12.md` | `passed` | `0` |
| `copy-content-agents-rest-client.json` | `passed` | `0` |
| `copy-content-agents-rest-client.md` | `passed` | `0` |
| `copy-materialized.json` | `passed` | `0` |
| `copy-materialized.usd` | `passed` | `0` |
| `copy-physics.json` | `passed` | `0` |
| `copy-physics.usd` | `passed` | `0` |

## Copied evidence

- `finish_json`: `docs/evidence/nvidia-finish-sadang-2026-06-13.json`
- `finish_md`: `docs/evidence/nvidia-finish-sadang-2026-06-13.md`
- `docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.json`: `docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.json`
- `docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.md`: `docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.md`
- `docs/evidence/nvidia-content-agents-deploy-status-sadang-2026-06-13.json`: `docs/evidence/nvidia-content-agents-deploy-status-sadang-2026-06-13.json`
- `docs/evidence/nvidia-content-agents-deploy-status-sadang-2026-06-13.md`: `docs/evidence/nvidia-content-agents-deploy-status-sadang-2026-06-13.md`
- `docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.json`: `docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.json`
- `docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.md`: `docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.md`
- `docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.json`: `docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.json`
- `docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.md`: `docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.md`
- `docs/evidence/nvidia-simready-validate-sadang-2026-06-12.json`: `docs/evidence/nvidia-simready-validate-sadang-2026-06-12.json`
- `docs/evidence/nvidia-simready-validate-sadang-2026-06-12.md`: `docs/evidence/nvidia-simready-validate-sadang-2026-06-12.md`
- `src/samples/sadang_317_6/omniverse/content_agents_run/content-agents-rest-client.json`: `src/samples/sadang_317_6/omniverse/content_agents_run/content-agents-rest-client.json`
- `src/samples/sadang_317_6/omniverse/content_agents_run/content-agents-rest-client.md`: `src/samples/sadang_317_6/omniverse/content_agents_run/content-agents-rest-client.md`
- `src/samples/sadang_317_6/omniverse/content_agents_run/material/materialized.json`: `src/samples/sadang_317_6/omniverse/content_agents_run/material/materialized.json`
- `src/samples/sadang_317_6/omniverse/content_agents_run/material/materialized.usd`: `src/samples/sadang_317_6/omniverse/content_agents_run/material/materialized.usd`
- `src/samples/sadang_317_6/omniverse/content_agents_run/physics/physics.json`: `src/samples/sadang_317_6/omniverse/content_agents_run/physics/physics.json`
- `src/samples/sadang_317_6/omniverse/content_agents_run/physics/physics.usd`: `src/samples/sadang_317_6/omniverse/content_agents_run/physics/physics.usd`

## Next commands

- `npm run nvidia:finish:remote -- --host train1 --remote-nvidia-api-key-file /secure/path/nvidia_api_key`
- `npm run nvidia:finish:remote -- --host train1 --allow-blocked`
