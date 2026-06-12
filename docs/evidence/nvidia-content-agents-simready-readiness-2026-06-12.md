# NVIDIA Content Agents / SimReady readiness — 2026-06-12

Status: **blocked_content_agents_and_simready_credentials_runtime**

## What is already proven

- OpenUSD package authored and local usdchecker passed
- train1 ovrtx first-frame evidence passed
- train1 ovrtx→ovstream server readiness passed
- train1 @nvidia/ov-web-rtc Direct browser first-frame evidence passed
- train1 package validation passed with SimReady/Content Agents preflight gates present

## Remaining blockers

- No NVIDIA_API_KEY/NGC_API_KEY/NVCF_API_KEY or provided Content Agents service endpoints are present locally or on train1.
- Content Agents material/physics wrapper blocks at missing CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.
- simready-validate is not on PATH and no SimReady Foundation checkout is configured locally or on train1.

## Direct runner evidence

- Content Agents router dependency check: `passed=true` for local wrapper scripts, but actual material+physics run on `sadang_317_6.usda` stops at missing Material Agent endpoint.
- SimReady validate dependency check: `passed=false`; `simready-validate` executable and SimReady Foundation checkout are missing.
- train1 probe: NVIDIA render/stream modules exist from earlier work, but Content Agents env, `simready-validate`, SimReady Foundation root, and content-agents upstream root are missing.

## Next required inputs

- Provide NVIDIA_API_KEY from build.nvidia.com for local Content Agents deployment on a GPU host, or provide healthy CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL, CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL, and OVRTX_RENDER_ENDPOINT/CONTENT_AGENTS_OVRTX_BASE_URL.
- Provide simready-validate on PATH or a SimReady Foundation checkout on branch main via SIMREADY_FOUNDATION_ROOT.
- After those are present, rerun npm run nvidia:preflight, Content Agents material+physics assignment, simready-conform-profile, and simready-validate.

See `nvidia-content-agents-simready-readiness-2026-06-12.json` for redacted environment state and full runner reports.
