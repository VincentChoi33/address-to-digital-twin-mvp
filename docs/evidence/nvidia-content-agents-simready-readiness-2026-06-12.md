# NVIDIA Content Agents / SimReady readiness — 2026-06-12

Status: **simready_profile_passed_content_agents_blocked**

## What is now proven

- OpenUSD package authored and local usdchecker passed
- train1 ovrtx first-frame evidence passed
- train1 ovrtx→ovstream server readiness passed
- train1 @nvidia/ov-web-rtc Direct browser first-frame evidence passed
- train1 package validation passed with SimReady/Content Agents preflight gates present
- Local SimReady Foundation checkout found at /Users/handy_choi/.physical-ai-skill-hub/upstreams/simready-foundation @ a1e9dd6
- simready-validate 2026.4.9 installed in Python 3.12 runner venv and executed
- Self-contained SimReady asset source passed Prop-Robotics-Neutral@1.0.0 profile validation across FET000/FET001/FET003/FET004/FET005/FET006

## Remaining blockers

- No NVIDIA_API_KEY/NGC_API_KEY/NVCF_API_KEY or complete provided Content Agents Material/Physics/OVRTX endpoint set is present locally.
- Content Agents material/physics wrapper cannot run until CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL, CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL, and OVRTX_RENDER_ENDPOINT/CONTENT_AGENTS_OVRTX_BASE_URL are provided, or a GPU-host NVIDIA_API_KEY deployment is configured.
- Local Mac still has no NVIDIA GPU/Omniverse runtime; RTX/ovstream evidence remains from train1 and must be reproduced on the target persistent GPU host.

## Direct runner evidence

- SimReady validation: `passed=True` for `Prop-Robotics-Neutral@1.0.0` on `simready_asset/sadang_317_6/simready_usd/sadang_317_6.usda`.
- Feature results: `FET000_CORE=True`, `FET001_BASE_NEUTRAL=True`, `FET003_BASE_NEUTRAL=True`, `FET004_BASE_NEUTRAL=True`, `FET005_BASE_NEUTRAL=True`, `FET006_BASE_MDL=True`.
- Content Agents router/wrappers are present, but actual material+physics assignment is blocked by missing Material/Physics/OVRTX endpoints or NVIDIA/NGC/NVCF auth.
- Prior Claude/NVIDIA research was found on `max`; only the public-safe stack mapping is carried forward here, not the personal/career source notes.

## Next required inputs

- Provide NVIDIA_API_KEY from build.nvidia.com for local Content Agents deployment on a GPU host, or provide healthy CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL, CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL, and OVRTX_RENDER_ENDPOINT/CONTENT_AGENTS_OVRTX_BASE_URL.
- Run Content Agents material+physics assignment and persist the generated materialized/physics USD plus reports.
- Re-run npm run nvidia:package and simready-validate after Content Agents output if you want a full Content-Agents-assisted SimReady claim rather than the current authored-profile pass.

See `nvidia-content-agents-simready-readiness-2026-06-12.json` and `nvidia-simready-validate-sadang-2026-06-12.json` for machine-readable evidence.
