# NVIDIA Content Agents deployment plan

Status: **blocked**

- Action: `plan`
- Passed: `False`
- Upstream: `.physical-ai-skill-hub/upstreams/content-agents` @ `5be4f88`
- Runtime dir: `.tmp/nvidia-content-agents`
- Endpoint env: `.tmp/nvidia-content-agents/endpoints.env`
- Secret handling: secret values are never printed; up mode writes an ignored 0600 runtime env file under .tmp
- GPU assignment: `auto_multi_gpu_split`; material OVRTX=`0`, physics OVRTX=`1`

## Blockers

- NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.

## Endpoints after `up`

| Service | URL |
| --- | --- |
| `material` | `http://127.0.0.1:8100` |
| `physics` | `http://127.0.0.1:8200` |
| `material_ovrtx` | `http://127.0.0.1:8101` |
| `physics_ovrtx` | `http://127.0.0.1:8201` |

## Redacted NVIDIA env

| Variable | State |
| --- | --- |
| `NVIDIA_API_KEY` | `missing` |
| `NVIDIA_API_KEY_FILE` | `missing` |
| `INFERENCE_NVIDIA_API_KEY` | `missing` |

## Planned commands

### up
- `docker compose -p address-twin-material -f /home/choihy/.tmp/nvidia-content-agents/material/docker-compose.yml up -d --build`
- `docker compose -p address-twin-physics -f /home/choihy/.tmp/nvidia-content-agents/physics/docker-compose.yml up -d --build`

### status
- `npm run nvidia:content-agents:deploy -- status`

### down
- `docker compose -p address-twin-physics -f /home/choihy/.tmp/nvidia-content-agents/physics/docker-compose.yml down`
- `docker compose -p address-twin-material -f /home/choihy/.tmp/nvidia-content-agents/material/docker-compose.yml down`

### run_assignment_after_ready
- `source /home/choihy/.tmp/nvidia-content-agents/endpoints.env`
- `export CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL=http://127.0.0.1:8100`
- `export CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL=http://127.0.0.1:8200`
- `npm run nvidia:content-agents`
- `npm run nvidia:simready`

After both Material and Physics endpoints are healthy, export the endpoint URLs and run `npm run nvidia:content-agents`, then rerun `npm run nvidia:simready`.
