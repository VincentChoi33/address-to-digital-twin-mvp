# NVIDIA Content Agents run — sadang_317_6

Status: **passed**

- Passed: `True`
- Input USD: `src/samples/sadang_317_6/omniverse/simready_asset/sadang_317_6/simready_usd/sadang_317_6.usda`
- Output dir: `src/samples/sadang_317_6/omniverse/content_agents_run`
- Router available: `False`
- Materialized USD: `${HOME}/workspace/personal/address-to-digital-twin-mvp/src/samples/sadang_317_6/omniverse/content_agents_run/material/materialized.usd`
- Physics USD: `${HOME}/workspace/personal/address-to-digital-twin-mvp/src/samples/sadang_317_6/omniverse/content_agents_run/physics/physics.usd`
- Next step: `rerun-simready-validation-on-content-agents-output`
- Usage token required: `False`
- Render endpoint required: `False`
- Upstream checkout: `~/.physical-ai-skill-hub/upstreams/content-agents`

## Provided endpoints

| Endpoint | Source env |
| --- | --- |
| `deployment_auth` | `NVIDIA_API_KEY_FILE` |
| `material` | `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` |
| `ovrtx_render` | `CONTENT_AGENTS_OVRTX_BASE_URL` |
| `physics` | `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` |
| `usage_auth` | `missing` |

## Redacted environment

| Variable | State |
| --- | --- |
| `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` | `present` |
| `CONTENT_AGENTS_MATERIAL_AGENT_TOKEN` | `missing` |
| `CONTENT_AGENTS_MATERIAL_AGENT_TOKEN_FILE` | `missing` |
| `CONTENT_AGENTS_OVRTX_BASE_URL` | `present` |
| `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` | `present` |
| `CONTENT_AGENTS_PHYSICS_AGENT_TOKEN` | `missing` |
| `CONTENT_AGENTS_PHYSICS_AGENT_TOKEN_FILE` | `missing` |
| `CONTENT_AGENTS_TOKEN` | `missing` |
| `CONTENT_AGENTS_TOKEN_FILE` | `missing` |
| `MATERIAL_AGENT_BASE_URL` | `missing` |
| `NGC_API_KEY` | `missing` |
| `NGC_API_KEY_FILE` | `missing` |
| `NVCF_API_KEY` | `missing` |
| `NVCF_API_KEY_FILE` | `missing` |
| `NVIDIA_API_KEY` | `missing` |
| `NVIDIA_API_KEY_FILE` | `present` |
| `OVRTX_RENDER_ENDPOINT` | `missing` |
| `PHYSICS_AGENT_BASE_URL` | `missing` |
| `RENDER_ENDPOINT` | `present` |

This report was produced by real NVIDIA Content Agents Material→Physics services; it does not use browser-side or mock material/physics assignment.
