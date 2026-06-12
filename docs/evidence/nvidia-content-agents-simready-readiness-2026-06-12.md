# NVIDIA Content Agents / SimReady readiness — 2026-06-12

Status: **simready_profile_passed_content_agents_blocked**

## What is now proven

- OpenUSD package authored and local usdchecker passed
- train1 ovrtx first-frame evidence passed
- train1 ovrtx→ovstream server readiness passed
- train1 @nvidia/ov-web-rtc Direct browser first-frame evidence passed
- train1 package validation passed with SimReady/Content Agents preflight gates present
- Local SimReady Foundation checkout found at ~/.physical-ai-skill-hub/upstreams/simready-foundation @ a1e9dd6
- simready-validate 2026.4.9 installed in Python 3.12 runner venv and executed
- Self-contained SimReady asset source passed Prop-Robotics-Neutral@1.0.0 profile validation across FET000/FET001/FET003/FET004/FET005/FET006

## Remaining blockers

- No healthy Content Agents Material/Physics endpoint set is present locally.
- NVIDIA_API_KEY deployment auth is missing, so missing OVRTX/Material/Physics services cannot be deployed from the NVIDIA upstream deployment skills.
- Local Mac still has no NVIDIA GPU/Omniverse runtime; RTX/ovstream/Warp evidence remains from train1 and must be reproduced on the target persistent GPU host.

## Direct runner evidence

- Repo command evidence: `npm run nvidia:content-agents:check` writes [`nvidia-content-agents-run-sadang-2026-06-12.md`](nvidia-content-agents-run-sadang-2026-06-12.md) and is blocked only by missing real NVIDIA endpoints/deployment auth, not by missing wrapper code.
- SimReady validation: `passed=True` for `Prop-Robotics-Neutral@1.0.0` on `simready_asset/sadang_317_6/simready_usd/sadang_317_6.usda`.
- Feature results: `FET000_CORE=True`, `FET001_BASE_NEUTRAL=True`, `FET003_BASE_NEUTRAL=True`, `FET004_BASE_NEUTRAL=True`, `FET005_BASE_NEUTRAL=True`, `FET006_BASE_MDL=True`.
- Content Agents router/wrappers are present, but actual material+physics assignment is blocked by missing Material/Physics endpoints or `NVIDIA_API_KEY` deployment auth. Existing endpoints may manage auth themselves; usage tokens are only required when those endpoints require bearer auth.
- Prior Claude/NVIDIA research was found on `max`; only the public-safe stack mapping is carried forward here, not the personal/career source notes.

## Next required inputs

- Provide healthy `CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL` and `CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL`; set endpoint usage tokens only if those endpoints require bearer auth. Or provide `NVIDIA_API_KEY` to deploy missing OVRTX/Material/Physics services from the NVIDIA upstream `content-agents` checkout, then export the resulting Material/Physics endpoints.
- Run `npm run nvidia:content-agents` to execute NVIDIA Material→Physics assignment and persist the output USD/reports.
- Re-run `npm run nvidia:simready` after Content Agents output and keep CI green.

See `nvidia-content-agents-simready-readiness-2026-06-12.json` and `nvidia-simready-validate-sadang-2026-06-12.json` for machine-readable evidence.
