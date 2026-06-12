# NVIDIA Content Agents deployment audit

Status: **blocked**

- Host: `gpu1`
- Upstream: `.physical-ai-skill-hub/upstreams/content-agents` @ `5be4f88`
- Secret handling: read-only deployment prerequisite audit; no containers were started and no secret values were printed

## Blockers

- NVIDIA_API_KEY is missing for NVIDIA-only provider-backed Content Agents deployment.
- No VLM provider credential is present; upstream Material/Physics deployment requires at least one provider key.

## Key checks

| Check | OK |
| --- | --- |
| `nvidia_smi` | `True` |
| `docker_version` | `True` |
| `docker_compose_version` | `True` |
| `docker_info` | `True` |
| `docker_gpu_smoke` | `True` |

## Ports

| Service | Port | Available |
| --- | ---: | --- |
| `ovrtx` | 8001 | `True` |
| `material` | 8100 | `True` |
| `physics` | 8200 | `True` |

## Redacted provider env

| Variable | State |
| --- | --- |
| `NVIDIA_API_KEY` | `missing` |
| `OPENAI_API_KEY` | `missing` |
| `ANTHROPIC_API_KEY` | `missing` |
| `GOOGLE_API_KEY` | `missing` |

## Deployment plan

- `ovrtx`: `OVRTX_RENDER_MODE=pt docker compose -f apps/ovrtx_rendering_api/docker-compose.yml up --build` → `RENDER_ENDPOINT=http://<gpu-host>:8001`
- `material`: `docker compose -f apps/material_agent_service/docker-compose.yml up --build` → `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL=http://<gpu-host>:8100 or the mapped material service port`
- `physics`: `docker compose -f apps/physics_agent_service/docker-compose.yml up --build` → `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL=http://<gpu-host>:8200 or the mapped physics service port`
