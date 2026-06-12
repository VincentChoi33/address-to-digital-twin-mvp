# NVIDIA train1 Content Agents environment audit — 2026-06-13

Host: `train1` / `gpu1`

Status: **blocked**

This is a presence-only audit. Secret values were not printed or persisted.

| Variable | State |
| --- | --- |
| `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` | missing |
| `MATERIAL_AGENT_BASE_URL` | missing |
| `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL` | missing |
| `PHYSICS_AGENT_BASE_URL` | missing |
| `CONTENT_AGENTS_OVRTX_BASE_URL` | missing |
| `OVRTX_RENDER_ENDPOINT` | missing |
| `RENDER_ENDPOINT` | missing |
| `CONTENT_AGENTS_TOKEN` | missing |
| `NGC_API_KEY` | missing |
| `NVCF_API_KEY` | missing |
| `NVIDIA_API_KEY` | missing |

## Blockers

- Missing Material Agent endpoint: CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.
- Missing Physics Agent endpoint: CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.
- Missing OVRTX/render endpoint: CONTENT_AGENTS_OVRTX_BASE_URL, OVRTX_RENDER_ENDPOINT, or RENDER_ENDPOINT.
- Missing Content Agents auth token/key: CONTENT_AGENTS_TOKEN, NGC_API_KEY, NVCF_API_KEY, or NVIDIA_API_KEY.
