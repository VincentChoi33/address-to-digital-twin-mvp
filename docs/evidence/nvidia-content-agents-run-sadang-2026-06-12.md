# NVIDIA Content Agents run — sadang_317_6

Status: **blocked**

- Passed: `False`
- Input USD: `src/samples/sadang_317_6/omniverse/simready_asset/sadang_317_6/simready_usd/sadang_317_6.usda`
- Output dir: `src/samples/sadang_317_6/omniverse/content_agents_run`
- Router available: `True`
- Materialized USD: `none`
- Physics USD: `none`
- Next step: `provide-content-agents-endpoints-and-auth`

## Blockers

- Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.
- Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.
- Missing OVRTX/render endpoint: set CONTENT_AGENTS_OVRTX_BASE_URL, OVRTX_RENDER_ENDPOINT, or RENDER_ENDPOINT.
- Missing Content Agents auth token/key: set CONTENT_AGENTS_TOKEN, agent-specific token, NGC_API_KEY, NVCF_API_KEY, or NVIDIA_API_KEY.

## Redacted environment

| Variable | State |
| --- | --- |
| `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` | `missing` |
| `CONTENT_AGENTS_MATERIAL_AGENT_TOKEN` | `missing` |
| `CONTENT_AGENTS_OVRTX_BASE_URL` | `missing` |
| `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` | `missing` |
| `CONTENT_AGENTS_PHYSICS_AGENT_TOKEN` | `missing` |
| `CONTENT_AGENTS_TOKEN` | `missing` |
| `MATERIAL_AGENT_BASE_URL` | `missing` |
| `NGC_API_KEY` | `missing` |
| `NVCF_API_KEY` | `missing` |
| `NVIDIA_API_KEY` | `missing` |
| `OVRTX_RENDER_ENDPOINT` | `missing` |
| `PHYSICS_AGENT_BASE_URL` | `missing` |
| `RENDER_ENDPOINT` | `missing` |

This report is blocked until real NVIDIA Content Agents endpoints/auth are provided; it does not substitute browser or mock material/physics assignment.
