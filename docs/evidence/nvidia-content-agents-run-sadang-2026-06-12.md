# NVIDIA Content Agents run — sadang_317_6

Status: **blocked**

- Passed: `False`
- Input USD: `src/samples/sadang_317_6/omniverse/simready_asset/sadang_317_6/simready_usd/sadang_317_6.usda`
- Output dir: `src/samples/sadang_317_6/omniverse/content_agents_run`
- Router available: `True`
- Materialized USD: `none`
- Physics USD: `none`
- Next step: `provide-content-agents-endpoints-and-auth`
- Usage token required: `False`
- Render endpoint required: `False`
- Upstream checkout: `~/.physical-ai-skill-hub/upstreams/content-agents`

## Blockers

- Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.
- Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.
- Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.

## Deployment handoffs

- `ovrtx` → `deploy-ovrtx-docker`: Shared OVRTX renderer is needed before deploying or troubleshooting render-dependent Content Agents services.
- `material` → `deploy-material-agent-docker`: Material Agent endpoint is missing for visual material assignment.
- `physics` → `deploy-physics-agent-docker`: Physics Agent endpoint is missing for physics property assignment.

## Provided endpoints

| Endpoint | Source env |
| --- | --- |
| `deployment_auth` | `missing` |
| `material` | `missing` |
| `ovrtx_render` | `missing` |
| `physics` | `missing` |
| `usage_auth` | `missing` |

## Redacted environment

| Variable | State |
| --- | --- |
| `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` | `missing` |
| `CONTENT_AGENTS_MATERIAL_AGENT_TOKEN` | `missing` |
| `CONTENT_AGENTS_MATERIAL_AGENT_TOKEN_FILE` | `missing` |
| `CONTENT_AGENTS_OVRTX_BASE_URL` | `missing` |
| `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` | `missing` |
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
| `NVIDIA_API_KEY_FILE` | `missing` |
| `OVRTX_RENDER_ENDPOINT` | `missing` |
| `PHYSICS_AGENT_BASE_URL` | `missing` |
| `RENDER_ENDPOINT` | `missing` |

This report is blocked until real NVIDIA Content Agents endpoints or deployment prerequisites are provided; it does not substitute browser or mock material/physics assignment.
