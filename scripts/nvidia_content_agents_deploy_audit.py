#!/usr/bin/env python3
"""Audit host readiness to deploy NVIDIA Omniverse Content Agents services.

This does not deploy containers and never prints secret values. It checks whether
an NVIDIA GPU host has the Docker/GPU/upstream/port prerequisites needed to run
the official NVIDIA `content-agents` deployment skills, and reports the exact
remaining blockers for OVRTX + Material + Physics service deployment.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import socket
import subprocess
from typing import Any
from urllib.request import urlopen

DEFAULT_OUTPUT_JSON = "docs/evidence/nvidia-content-agents-deploy-audit-sadang-2026-06-13.json"
DEFAULT_OUTPUT_MD = "docs/evidence/nvidia-content-agents-deploy-audit-sadang-2026-06-13.md"
DEFAULT_CUDA_IMAGE = "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04"
PORTS = {
    "ovrtx": 8001,
    "material": 8100,
    "physics": 8200,
}
PROVIDER_ENVS = ("NVIDIA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY")
UPSTREAM_SKILLS = {
    "ovrtx": ".agents/skills/deploy-ovrtx-docker/SKILL.md",
    "material": ".agents/skills/deploy-material-agent-docker/SKILL.md",
    "physics": ".agents/skills/deploy-physics-agent-docker/SKILL.md",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit NVIDIA Content Agents deployment prerequisites.")
    parser.add_argument("--output-json", default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", default=DEFAULT_OUTPUT_MD)
    parser.add_argument("--cuda-image", default=DEFAULT_CUDA_IMAGE)
    parser.add_argument("--skip-docker-gpu-smoke", action="store_true", help="Skip docker run --gpus smoke when only static audit is needed.")
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 even when deployment is blocked.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    upstream = resolve_upstream()
    checks = {
        "nvidia_smi": run_command(["nvidia-smi", "-L"], timeout=20),
        "docker_version": run_command(["docker", "--version"], timeout=20),
        "docker_compose_version": run_command(["docker", "compose", "version"], timeout=20),
        "docker_info": run_command(["docker", "info"], timeout=30),
    }
    if args.skip_docker_gpu_smoke:
        checks["docker_gpu_smoke"] = {"ok": False, "skipped": True, "stdout": "", "stderr": "skipped", "code": None}
    else:
        checks["docker_gpu_smoke"] = run_command(["docker", "run", "--rm", "--gpus", "all", args.cuda_image, "nvidia-smi", "-L"], timeout=120)

    redacted_env = {name: "present" if os.environ.get(name) or os.environ.get(f"{name}_FILE") else "missing" for name in PROVIDER_ENVS}
    provider_present = any(state == "present" for state in redacted_env.values())
    nvidia_api_present = redacted_env["NVIDIA_API_KEY"] == "present"
    port_state = {name: port_available(port) for name, port in PORTS.items()}
    health = probe_health()
    upstream_info = upstream_report(upstream, repo_root)

    blockers: list[str] = []
    if not checks["nvidia_smi"]["ok"]:
        blockers.append("NVIDIA GPU/driver is not visible via nvidia-smi.")
    if not checks["docker_version"]["ok"]:
        blockers.append("Docker CLI is missing.")
    if not checks["docker_compose_version"]["ok"]:
        blockers.append("Docker Compose v2 is missing.")
    if not checks["docker_info"]["ok"]:
        blockers.append("Docker daemon is not reachable.")
    if not args.skip_docker_gpu_smoke and not checks["docker_gpu_smoke"]["ok"]:
        blockers.append("NVIDIA Container Toolkit smoke failed: docker run --gpus all could not run nvidia-smi.")
    if not upstream:
        blockers.append("NVIDIA content-agents upstream checkout is missing; clone https://github.com/nvidia-omniverse/content-agents.git on branch main.")
    for service, available in port_state.items():
        if not available and not health.get(service, {}).get("healthy"):
            blockers.append(f"Host port {PORTS[service]} for {service} is already in use and no healthy {service} service was detected there.")
    if not nvidia_api_present:
        blockers.append("NVIDIA_API_KEY is missing for NVIDIA-only provider-backed Content Agents deployment.")
    if not provider_present:
        blockers.append("No VLM provider credential is present; upstream Material/Physics deployment requires at least one provider key.")

    deployment_ready = not blockers
    report = {
        "status": "ready" if deployment_ready else "blocked",
        "passed": deployment_ready,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": hostname(),
        "audit_scope": "read-only deployment prerequisite audit; no containers were started and no secret values were printed",
        "checks": checks,
        "redacted_environment": redacted_env,
        "ports": {name: {"port": port, "available": port_state[name]} for name, port in PORTS.items()},
        "service_health": health,
        "content_agents_upstream": upstream_info,
        "deployment_plan": deployment_plan(),
        "blockers": blockers,
    }
    write_reports(report, Path(args.output_json), Path(args.output_md))
    print(json.dumps({"status": report["status"], "output_json": args.output_json, "output_md": args.output_md, "blockers": blockers}, indent=2))
    return 0 if deployment_ready or args.allow_blocked else 2


def run_command(command: list[str], timeout: int) -> dict[str, Any]:
    try:
        completed = subprocess.run(command, text=True, capture_output=True, timeout=timeout)
        return {
            "ok": completed.returncode == 0,
            "code": completed.returncode,
            "stdout": tail(completed.stdout),
            "stderr": tail(completed.stderr),
            "command": redact_command(command),
        }
    except FileNotFoundError as exc:
        return {"ok": False, "code": None, "stdout": "", "stderr": str(exc), "command": redact_command(command)}
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "code": None, "stdout": tail(exc.stdout or ""), "stderr": f"timeout after {timeout}s", "command": redact_command(command)}


def redact_command(command: list[str]) -> list[str]:
    return [item if not any(secret in item.upper() for secret in ("KEY", "TOKEN", "SECRET")) else "<redacted>" for item in command]


def tail(value: str, max_chars: int = 2000) -> str:
    return value[-max_chars:]


def hostname() -> str:
    return run_command(["hostname"], timeout=5).get("stdout", "").strip() or "unknown"


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def probe_health() -> dict[str, dict[str, Any]]:
    urls = {
        "ovrtx": f"http://127.0.0.1:{PORTS['ovrtx']}/health",
        "material": f"http://127.0.0.1:{PORTS['material']}/health",
        "physics": f"http://127.0.0.1:{PORTS['physics']}/health",
    }
    result: dict[str, dict[str, Any]] = {}
    for name, url in urls.items():
        try:
            with urlopen(url, timeout=3) as response:
                body = response.read(1000).decode("utf-8", errors="replace")
                healthy = response.status == 200 and ("unhealthy" not in body.lower())
                if name == "ovrtx" and "gpu_initialized" in body:
                    try:
                        healthy = healthy and bool(json.loads(body).get("gpu_initialized"))
                    except json.JSONDecodeError:
                        healthy = healthy and '"gpu_initialized":true' in body.lower().replace(" ", "")
                result[name] = {"url": url, "reachable": True, "status": response.status, "healthy": healthy, "body_tail": tail(body, 500)}
        except Exception as exc:
            result[name] = {"url": url, "reachable": False, "healthy": False, "error": type(exc).__name__}
    return result


def resolve_upstream() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("CONTENT_AGENTS_UPSTREAM_ROOT"):
        candidates.append(Path(os.environ["CONTENT_AGENTS_UPSTREAM_ROOT"]).expanduser())
    if os.environ.get("PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT"):
        candidates.append(Path(os.environ["PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT"]).expanduser() / "content-agents")
    candidates.append(Path.home() / ".physical-ai-skill-hub/upstreams/content-agents")
    for candidate in candidates:
        if (candidate / ".git").is_dir() and all((candidate / rel).is_file() for rel in UPSTREAM_SKILLS.values()):
            return candidate.resolve()
    return None


def upstream_report(upstream: Path | None, repo_root: Path) -> dict[str, Any]:
    if not upstream:
        return {"available": False, "path": None, "branch": None, "commit": None, "deployment_skill_paths": {}}
    return {
        "available": True,
        "path": display_path(upstream, repo_root),
        "branch": git_output(upstream, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "commit": git_output(upstream, ["rev-parse", "--short", "HEAD"]),
        "deployment_skill_paths": {name: display_path(upstream / rel, repo_root) for name, rel in UPSTREAM_SKILLS.items()},
    }


def git_output(repo: Path, args: list[str]) -> str | None:
    result = run_command(["git", "-C", str(repo), *args], timeout=10)
    return result["stdout"].strip() if result["ok"] and result["stdout"].strip() else None


def display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root))
    except ValueError:
        return str(path).replace(str(Path.home()), "~")


def deployment_plan() -> list[dict[str, str]]:
    return [
        {
            "target": "ovrtx",
            "command": "OVRTX_RENDER_MODE=pt docker compose -f apps/ovrtx_rendering_api/docker-compose.yml up --build",
            "endpoint": "RENDER_ENDPOINT=http://<gpu-host>:8001",
        },
        {
            "target": "material",
            "command": "docker compose -f apps/material_agent_service/docker-compose.yml up --build",
            "endpoint": "CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL=http://<gpu-host>:8100 or the mapped material service port",
        },
        {
            "target": "physics",
            "command": "docker compose -f apps/physics_agent_service/docker-compose.yml up --build",
            "endpoint": "CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL=http://<gpu-host>:8200 or the mapped physics service port",
        },
    ]


def write_reports(report: dict[str, Any], json_path: Path, md_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# NVIDIA Content Agents deployment audit",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Host: `{report['host']}`",
        f"- Upstream: `{report['content_agents_upstream'].get('path') or 'none'}` @ `{report['content_agents_upstream'].get('commit') or 'none'}`",
        f"- Secret handling: {report['audit_scope']}",
        "",
        "## Blockers",
        "",
    ]
    if report["blockers"]:
        lines.extend(f"- {blocker}" for blocker in report["blockers"])
    else:
        lines.append("- none")
    lines.extend(["", "## Key checks", "", "| Check | OK |", "| --- | --- |"])
    for name, check in report["checks"].items():
        lines.append(f"| `{name}` | `{check.get('ok')}` |")
    lines.extend(["", "## Ports", "", "| Service | Port | Available |", "| --- | ---: | --- |"])
    for name, info in report["ports"].items():
        lines.append(f"| `{name}` | {info['port']} | `{info['available']}` |")
    lines.extend(["", "## Redacted provider env", "", "| Variable | State |", "| --- | --- |"])
    for name, state in report["redacted_environment"].items():
        lines.append(f"| `{name}` | `{state}` |")
    lines.extend(["", "## Deployment plan", ""])
    for step in report["deployment_plan"]:
        lines.append(f"- `{step['target']}`: `{step['command']}` → `{step['endpoint']}`")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
