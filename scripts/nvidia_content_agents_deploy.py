#!/usr/bin/env python3
"""Deploy or plan NVIDIA Omniverse Content Agents services from upstream.

The repo already has a Content Agents *run* command that delegates to the
NVIDIA reference router once Material/Physics endpoints exist.  This helper is
the missing deployment bridge: it turns the official NVIDIA `content-agents`
Docker Compose stacks into a repo-native, NVIDIA-only launch path.

It is intentionally conservative:

* default `plan` mode is read-only and never prints secrets;
* `up` refuses to start services unless `NVIDIA_API_KEY` or
  `NVIDIA_API_KEY_FILE` is present;
* the key is written only to an ignored runtime env file under `.tmp/` with
  user-only permissions;
* Material and Physics ports are remapped away from the upstream 8000/8001
  defaults so both services can run together on the same GPU host.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import time
from typing import Any
from urllib.request import urlopen

DEFAULT_PROJECT_ID = "sadang_317_6"
DEFAULT_OUTPUT_JSON = "docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.json"
DEFAULT_OUTPUT_MD = "docs/evidence/nvidia-content-agents-deploy-plan-sadang-2026-06-13.md"
DEFAULT_CUDA_IMAGE = "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04"
UPSTREAM_COMPOSE = {
    "material": "apps/material_agent_service/docker-compose.yml",
    "physics": "apps/physics_agent_service/docker-compose.yml",
}
DEFAULT_PORTS = {
    "material": 8100,
    "material_ovrtx": 8101,
    "physics": 8200,
    "physics_ovrtx": 8201,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy or plan NVIDIA Content Agents Docker services.")
    parser.add_argument("action", nargs="?", choices=("plan", "up", "down", "status"), default="plan")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--upstream-root", default=os.environ.get("CONTENT_AGENTS_UPSTREAM_ROOT"))
    parser.add_argument("--runtime-dir", default=".tmp/nvidia-content-agents")
    parser.add_argument("--output-json", default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", default=DEFAULT_OUTPUT_MD)
    parser.add_argument("--material-port", type=int, default=DEFAULT_PORTS["material"])
    parser.add_argument("--material-ovrtx-port", type=int, default=DEFAULT_PORTS["material_ovrtx"])
    parser.add_argument("--physics-port", type=int, default=DEFAULT_PORTS["physics"])
    parser.add_argument("--physics-ovrtx-port", type=int, default=DEFAULT_PORTS["physics_ovrtx"])
    parser.add_argument("--material-gpu", default=os.environ.get("CONTENT_AGENTS_MATERIAL_GPU"), help="GPU id(s) exposed to the Material OVRTX sidecar; auto-pins to GPU 0 on multi-GPU hosts.")
    parser.add_argument("--physics-gpu", default=os.environ.get("CONTENT_AGENTS_PHYSICS_GPU"), help="GPU id(s) exposed to the Physics OVRTX sidecar; auto-pins to GPU 1 on multi-GPU hosts.")
    parser.add_argument("--wait-seconds", type=int, default=0, help="After up/status, poll service health for this many seconds before writing the final status.")
    parser.add_argument("--cuda-image", default=DEFAULT_CUDA_IMAGE)
    parser.add_argument("--skip-docker-gpu-smoke", action="store_true")
    parser.add_argument("--skip-build", action="store_true", help="Use docker compose up -d without --build.")
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 for blocked plan/status reports.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    upstream = resolve_upstream(args.upstream_root)
    runtime_dir = (repo_root / args.runtime_dir).resolve()
    ports = {
        "material": args.material_port,
        "material_ovrtx": args.material_ovrtx_port,
        "physics": args.physics_port,
        "physics_ovrtx": args.physics_ovrtx_port,
    }
    checks = collect_checks(args, upstream, ports)
    gpu_assignment = infer_gpu_assignment(args, checks["nvidia_smi"].get("stdout", ""))
    report = build_base_report(args.action, args.project_id, repo_root, upstream, runtime_dir, ports, gpu_assignment)
    report["checks"] = checks
    report["service_health"] = probe_services(ports)
    report["commands"] = planned_commands(runtime_dir, ports, args.skip_build, args.wait_seconds)

    blockers = blockers_for(args.action, report, upstream, ports)
    report["blockers"] = blockers

    if args.action == "up" and not blockers:
        render_runtime_files(upstream, runtime_dir, ports, gpu_assignment)
        up_result = run_up(runtime_dir, args.skip_build)
        report["execution"] = up_result
        wait_report = wait_for_services(ports, args.wait_seconds) if up_result["ok"] and args.wait_seconds > 0 else None
        if wait_report:
            report["wait"] = wait_report
            report["service_health"] = wait_report["service_health"]
        else:
            report["service_health"] = probe_services(ports)
        report["status"] = ("ready" if wait_report and wait_report["ready"] else "running") if up_result["ok"] else "failed"
        report["passed"] = bool(up_result["ok"] and (not wait_report or wait_report["ready"]))
        if not up_result["ok"]:
            report["blockers"] = ["docker compose up failed; inspect execution.stderr_tail and container logs."]
    elif args.action == "down":
        report["execution"] = run_down(runtime_dir)
        report["status"] = "stopped" if report["execution"]["ok"] else "failed"
        report["passed"] = bool(report["execution"]["ok"])
    elif args.action == "status":
        wait_report = wait_for_services(ports, args.wait_seconds) if args.wait_seconds > 0 else None
        if wait_report:
            report["wait"] = wait_report
            report["service_health"] = wait_report["service_health"]
            report["blockers"] = blockers_for(args.action, report, upstream, ports)
            blockers = report["blockers"]
        all_healthy = required_services_ready(report["service_health"])
        report["status"] = "ready" if all_healthy else ("blocked" if blockers else "warming")
        report["passed"] = all_healthy
    else:
        report["status"] = "ready_to_deploy" if not blockers else "blocked"
        report["passed"] = not blockers
        if upstream:
            render_runtime_files(upstream, runtime_dir, ports, gpu_assignment, write_secret=False)

    write_reports(report, Path(args.output_json), Path(args.output_md))
    print(json.dumps({"status": report["status"], "output_json": args.output_json, "output_md": args.output_md, "blockers": report["blockers"]}, indent=2))
    return 0 if report["passed"] or args.allow_blocked or args.action == "down" else 2


def build_base_report(
    action: str,
    project_id: str,
    repo_root: Path,
    upstream: Path | None,
    runtime_dir: Path,
    ports: dict[str, int],
    gpu_assignment: dict[str, Any],
) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "action": action,
        "status": "not_run",
        "passed": False,
        "secret_handling": "secret values are never printed; up mode writes an ignored 0600 runtime env file under .tmp",
        "runtime_dir": display_path(runtime_dir, repo_root),
        "endpoint_env_path": display_path(runtime_dir / "endpoints.env", repo_root),
        "redacted_environment": {
            "NVIDIA_API_KEY": "present" if os.environ.get("NVIDIA_API_KEY") else "missing",
            "NVIDIA_API_KEY_FILE": "present" if os.environ.get("NVIDIA_API_KEY_FILE") else "missing",
            "INFERENCE_NVIDIA_API_KEY": "present" if os.environ.get("INFERENCE_NVIDIA_API_KEY") else "missing",
        },
        "content_agents_upstream": upstream_report(upstream, repo_root),
        "ports": ports,
        "gpu_assignment": gpu_assignment,
        "endpoints_after_up": {
            "material": f"http://127.0.0.1:{ports['material']}",
            "physics": f"http://127.0.0.1:{ports['physics']}",
            "material_ovrtx": f"http://127.0.0.1:{ports['material_ovrtx']}",
            "physics_ovrtx": f"http://127.0.0.1:{ports['physics_ovrtx']}",
        },
        "nvidia_only_provider_policy": {
            "required_provider": "NVIDIA build.nvidia.com / NIM via NVIDIA_API_KEY",
            "material_overrides": {
                "MA_VLM_BACKEND": "nim",
                "MA_LLM_BACKEND": "nim",
                "MA_IMAGE_GEN_BACKEND": "nvidia_inference",
            },
            "physics_overrides": {
                "PA_VLM_BACKEND": "nim",
            },
        },
    }


def infer_gpu_assignment(args: argparse.Namespace, nvidia_smi_stdout: str) -> dict[str, Any]:
    material = normalize_gpu_arg(args.material_gpu)
    physics = normalize_gpu_arg(args.physics_gpu)
    gpu_count = count_nvidia_smi_gpus(nvidia_smi_stdout)
    policy = "explicit" if material or physics else "auto"
    if material is None and physics is None and gpu_count >= 2:
        material = "0"
        physics = "1"
        policy = "auto_multi_gpu_split"
    elif material is None and physics is None:
        policy = "single_gpu_or_unknown_no_pin"
    return {
        "policy": policy,
        "detected_gpu_count": gpu_count,
        "material_ovrtx_visible_devices": material,
        "physics_ovrtx_visible_devices": physics,
    }


def normalize_gpu_arg(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def count_nvidia_smi_gpus(stdout: str) -> int:
    return sum(1 for line in stdout.splitlines() if line.strip().startswith("GPU "))


def collect_checks(args: argparse.Namespace, upstream: Path | None, ports: dict[str, int]) -> dict[str, Any]:
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
    checks["upstream_compose"] = {
        "ok": bool(upstream and all((upstream / rel).is_file() for rel in UPSTREAM_COMPOSE.values())),
        "required": UPSTREAM_COMPOSE,
    }
    checks["ports_available"] = {name: {"ok": port_available(port), "port": port} for name, port in ports.items()}
    return checks


def blockers_for(action: str, report: dict[str, Any], upstream: Path | None, ports: dict[str, int]) -> list[str]:
    if action == "down":
        return []
    if action == "status":
        blockers: list[str] = []
        for name in ("material", "physics"):
            health = report["service_health"].get(name, {})
            if not health.get("healthy"):
                blockers.append(f"{name} endpoint is not healthy at http://127.0.0.1:{ports[name]}/health.")
        return blockers
    checks = report["checks"]
    blockers: list[str] = []
    if not upstream:
        blockers.append("NVIDIA content-agents upstream checkout is missing; set CONTENT_AGENTS_UPSTREAM_ROOT or clone https://github.com/nvidia-omniverse/content-agents.git.")
    if not checks["nvidia_smi"]["ok"]:
        blockers.append("NVIDIA GPU/driver is not visible via nvidia-smi.")
    if not checks["docker_version"]["ok"]:
        blockers.append("Docker CLI is missing.")
    if not checks["docker_compose_version"]["ok"]:
        blockers.append("Docker Compose v2 is missing.")
    if not checks["docker_info"]["ok"]:
        blockers.append("Docker daemon is not reachable.")
    if not checks["docker_gpu_smoke"].get("skipped") and not checks["docker_gpu_smoke"]["ok"]:
        blockers.append("NVIDIA Container Toolkit smoke failed: docker run --gpus all could not run nvidia-smi.")
    if not has_nvidia_api_key():
        blockers.append("NVIDIA_API_KEY or NVIDIA_API_KEY_FILE is required before deploying NVIDIA-only Material/Physics Content Agents.")
    for name, port in ports.items():
        health = report["service_health"].get(name, {})
        if not port_available(port) and not health.get("healthy"):
            blockers.append(f"Host port {port} for {name} is already in use and no healthy service was detected there.")
    return blockers


def render_runtime_files(
    upstream: Path | None,
    runtime_dir: Path,
    ports: dict[str, int],
    gpu_assignment: dict[str, Any],
    write_secret: bool = True,
) -> None:
    if not upstream:
        return
    material_dir = runtime_dir / "material"
    physics_dir = runtime_dir / "physics"
    material_dir.mkdir(parents=True, exist_ok=True)
    physics_dir.mkdir(parents=True, exist_ok=True)
    env_file = runtime_dir / "nvidia-runtime.env"
    write_endpoint_env(runtime_dir / "endpoints.env", ports)
    if write_secret:
        write_runtime_env(env_file)
    render_compose(
        upstream / UPSTREAM_COMPOSE["material"],
        material_dir / "docker-compose.yml",
        upstream,
        env_file,
        {
            '"8000:8000"': f'"{ports["material"]}:8000"',
            '"8001:8000"': f'"{ports["material_ovrtx"]}:8000"',
            "- RENDER_ENDPOINT=http://ovrtx-rendering-api:8000": f"- RENDER_ENDPOINT=http://127.0.0.1:{ports['material_ovrtx']}",
            "container_name: material-agent-service": "container_name: address-twin-material-agent-service",
            "container_name: ovrtx-rendering-api": "container_name: address-twin-material-ovrtx-rendering-api",
        },
        gpu_assignment.get("material_ovrtx_visible_devices"),
        {
            "material-agent-service": ("python", ports["material"]),
            "ovrtx-rendering-api": ("ovrtx", ports["material_ovrtx"]),
        },
    )
    render_compose(
        upstream / UPSTREAM_COMPOSE["physics"],
        physics_dir / "docker-compose.yml",
        upstream,
        env_file,
        {
            '"8000:8000"': f'"{ports["physics"]}:8000"',
            '"8001:8000"': f'"{ports["physics_ovrtx"]}:8000"',
            "- RENDER_ENDPOINT=http://ovrtx-rendering-api:8000": f"- RENDER_ENDPOINT=http://127.0.0.1:{ports['physics_ovrtx']}",
            "container_name: physics-agent-service": "container_name: address-twin-physics-agent-service",
            "container_name: physics-ovrtx-rendering-api": "container_name: address-twin-physics-ovrtx-rendering-api",
        },
        gpu_assignment.get("physics_ovrtx_visible_devices"),
        {
            "physics-agent-service": ("python", ports["physics"]),
            "ovrtx-rendering-api": ("ovrtx", ports["physics_ovrtx"]),
        },
    )


def write_runtime_env(path: Path) -> None:
    api_key = read_secret("NVIDIA_API_KEY")
    inference_key = os.environ.get("INFERENCE_NVIDIA_API_KEY") or api_key
    lines = [
        "# Generated by scripts/nvidia_content_agents_deploy.py; do not commit.",
        f"NVIDIA_API_KEY={env_value(api_key)}",
        f"INFERENCE_NVIDIA_API_KEY={env_value(inference_key)}",
        "MA_VLM_BACKEND=nim",
        "MA_LLM_BACKEND=nim",
        "MA_IMAGE_GEN_BACKEND=nvidia_inference",
        f"MA_IMAGE_GEN_API_KEY={env_value(inference_key)}",
        "PA_VLM_BACKEND=nim",
        "WU_NVCF_GLOBAL_MAX_CONCURRENT_REQUESTS=1",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def write_endpoint_env(path: Path, ports: dict[str, int]) -> None:
    lines = [
        "# Generated by scripts/nvidia_content_agents_deploy.py; safe to source.",
        f"CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL=http://127.0.0.1:{ports['material']}",
        f"CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL=http://127.0.0.1:{ports['physics']}",
        f"CONTENT_AGENTS_OVRTX_BASE_URL=http://127.0.0.1:{ports['material_ovrtx']}",
        f"RENDER_ENDPOINT=http://127.0.0.1:{ports['material_ovrtx']}",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def render_compose(
    source: Path,
    dest: Path,
    upstream: Path,
    env_file: Path,
    replacements: dict[str, str],
    gpu_device: str | None,
    service_ports: dict[str, tuple[str, int]],
) -> None:
    text = source.read_text(encoding="utf-8")
    text = text.replace("context: ../..", f"context: {upstream.as_posix()}")
    text = text.replace("- path: ../../.env", f"- path: {env_file.as_posix()}")
    text = add_host_network_to_builds(text)
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = add_host_network_runtime(text, service_ports)
    if gpu_device:
        text = text.replace(
            "- OVRTX_RENDER_MODE=${OVRTX_RENDER_MODE:-pt}",
            f"- OVRTX_RENDER_MODE=${{OVRTX_RENDER_MODE:-pt}}\n      - NVIDIA_VISIBLE_DEVICES={gpu_device}",
        )
    dest.write_text(text, encoding="utf-8")


def add_host_network_to_builds(text: str) -> str:
    """Use host networking for Docker builds so apt/pip use the host resolver.

    train1's Docker bridge resolver currently points at public DNS servers that
    are unreachable from build containers, while `--network host` resolves via
    systemd-resolved correctly. Compose supports this as `build.network`.
    """
    marker = "    build:\n"
    replacement = "    build:\n      network: host\n"
    if "      network: host\n" in text:
        return text
    return text.replace(marker, replacement)


def add_host_network_runtime(text: str, service_ports: dict[str, tuple[str, int]]) -> str:
    """Use host networking at runtime so Content Agents can reach NVIDIA NIM.

    On train1, Docker bridge containers can fail DNS/egress to public NVIDIA
    endpoints while the host network path succeeds.  Host networking removes
    port publishing, so every service gets an explicit uvicorn port and the
    generated RENDER_ENDPOINT values target 127.0.0.1.
    """
    lines = text.splitlines()
    for service_name, (kind, port) in service_ports.items():
        lines = transform_service_for_host_network(lines, service_name, kind, port)
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def transform_service_for_host_network(lines: list[str], service_name: str, kind: str, port: int) -> list[str]:
    header = f"  {service_name}:"
    try:
        start = lines.index(header)
    except ValueError:
        return lines
    end = service_section_end(lines, start + 1)
    section = lines[start:end]
    section = remove_service_key(section, "network_mode")
    section = remove_service_key(section, "command")
    section = remove_service_key(section, "ports")
    section = [
        section[0],
        "    network_mode: host",
        f"    command: {service_command(kind, port)}",
        *section[1:],
    ]
    rendered = "\n".join(section)
    rendered = rendered.replace("http://localhost:8000/health", f"http://localhost:{port}/health")
    if kind == "ovrtx" and "OVRTX_PARENT_PORT=" not in rendered:
        rendered = rendered.replace(
            "- OVRTX_RENDER_MODE=${OVRTX_RENDER_MODE:-pt}",
            f"- OVRTX_RENDER_MODE=${{OVRTX_RENDER_MODE:-pt}}\n      - OVRTX_PARENT_PORT={port}\n      - OVRTX_XVFB_DISPLAY={ovrtx_display(port)}",
        )
    return lines[:start] + rendered.splitlines() + lines[end:]


def service_section_end(lines: list[str], start: int) -> int:
    for index in range(start, len(lines)):
        line = lines[index]
        if line and not line.startswith(" "):
            return index
        if line.startswith("  ") and not line.startswith("    ") and line.endswith(":"):
            return index
    return len(lines)


def remove_service_key(section: list[str], key: str) -> list[str]:
    prefix = f"    {key}:"
    result: list[str] = []
    index = 0
    while index < len(section):
        line = section[index]
        if line == prefix or line.startswith(prefix + " "):
            index += 1
            while index < len(section) and not (section[index].startswith("    ") and not section[index].startswith("      ")):
                index += 1
            continue
        result.append(line)
        index += 1
    return result


def service_command(kind: str, port: int) -> str:
    if kind == "ovrtx":
        return f'["ovrtx-entrypoint", "python", "-m", "uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "{port}"]'
    return f'["python", "-m", "uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "{port}"]'


def ovrtx_display(port: int) -> int:
    # Host-networked OVRTX containers share the abstract X socket namespace.
    # Keep displays distinct so the second renderer does not crash on :99.
    if port == DEFAULT_PORTS["physics_ovrtx"]:
        return 100
    if port == DEFAULT_PORTS["material_ovrtx"]:
        return 99
    return 99 + max(0, port % 100)


def run_up(runtime_dir: Path, skip_build: bool) -> dict[str, Any]:
    base = ["docker", "compose"]
    up_args = ["up", "-d"]
    if not skip_build:
        up_args.append("--build")
    commands = [
        [*base, "-p", "address-twin-material", "-f", str(runtime_dir / "material/docker-compose.yml"), *up_args],
        [*base, "-p", "address-twin-physics", "-f", str(runtime_dir / "physics/docker-compose.yml"), *up_args],
    ]
    results = [run_command(command, timeout=1800) for command in commands]
    return {"ok": all(result["ok"] for result in results), "commands": [redact_command(command) for command in commands], "results": results}


def run_down(runtime_dir: Path) -> dict[str, Any]:
    commands = [
        ["docker", "compose", "-p", "address-twin-physics", "-f", str(runtime_dir / "physics/docker-compose.yml"), "down"],
        ["docker", "compose", "-p", "address-twin-material", "-f", str(runtime_dir / "material/docker-compose.yml"), "down"],
    ]
    results = [run_command(command, timeout=300) for command in commands if Path(command[5]).is_file()]
    return {"ok": all(result["ok"] for result in results), "commands": [redact_command(command) for command in commands], "results": results}


def planned_commands(runtime_dir: Path, ports: dict[str, int], skip_build: bool, wait_seconds: int) -> dict[str, list[str]]:
    up_suffix = "up -d" if skip_build else "up -d --build"
    wait_arg = f" --wait-seconds {wait_seconds}" if wait_seconds > 0 else ""
    return {
        "up": [
            f"docker compose -p address-twin-material -f {runtime_dir / 'material/docker-compose.yml'} {up_suffix}",
            f"docker compose -p address-twin-physics -f {runtime_dir / 'physics/docker-compose.yml'} {up_suffix}",
        ],
        "status": [
            f"npm run nvidia:content-agents:deploy -- status{wait_arg}",
        ],
        "down": [
            f"docker compose -p address-twin-physics -f {runtime_dir / 'physics/docker-compose.yml'} down",
            f"docker compose -p address-twin-material -f {runtime_dir / 'material/docker-compose.yml'} down",
        ],
        "run_assignment_after_ready": [
            f"source {runtime_dir / 'endpoints.env'}",
            f"export CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL=http://127.0.0.1:{ports['material']}",
            f"export CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL=http://127.0.0.1:{ports['physics']}",
            "npm run nvidia:content-agents",
            "npm run nvidia:simready",
        ],
    }


def probe_services(ports: dict[str, int]) -> dict[str, dict[str, Any]]:
    return {name: probe_health(name, port) for name, port in ports.items()}


def wait_for_services(ports: dict[str, int], wait_seconds: int) -> dict[str, Any]:
    deadline = time.monotonic() + max(0, wait_seconds)
    attempts = 0
    health = probe_services(ports)
    while not required_services_ready(health) and time.monotonic() < deadline:
        attempts += 1
        time.sleep(5)
        health = probe_services(ports)
    return {
        "ready": required_services_ready(health),
        "attempts": attempts + 1,
        "wait_seconds": wait_seconds,
        "service_health": health,
    }


def required_services_ready(health: dict[str, dict[str, Any]]) -> bool:
    required = ("material", "physics")
    return all(health.get(name, {}).get("healthy") for name in required)


def probe_health(name: str, port: int) -> dict[str, Any]:
    url = f"http://127.0.0.1:{port}/health"
    try:
        with urlopen(url, timeout=3) as response:
            body = response.read(1000).decode("utf-8", errors="replace")
            healthy = response.status == 200 and "unhealthy" not in body.lower()
            if "ovrtx" in name and "gpu_initialized" in body:
                try:
                    healthy = healthy and bool(json.loads(body).get("gpu_initialized"))
                except json.JSONDecodeError:
                    healthy = healthy and '"gpu_initialized":true' in body.lower().replace(" ", "")
            return {"url": url, "reachable": True, "status": response.status, "healthy": healthy, "body_tail": tail(body, 500)}
    except Exception as exc:
        return {"url": url, "reachable": False, "healthy": False, "error": type(exc).__name__}


def resolve_upstream(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.environ.get("PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT"):
        candidates.append(Path(os.environ["PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT"]).expanduser() / "content-agents")
    candidates.append(Path.home() / ".physical-ai-skill-hub/upstreams/content-agents")
    for candidate in candidates:
        if (candidate / ".git").is_dir() and all((candidate / rel).is_file() for rel in UPSTREAM_COMPOSE.values()):
            return candidate.resolve()
    return None


def upstream_report(upstream: Path | None, repo_root: Path) -> dict[str, Any]:
    if not upstream:
        return {"available": False, "path": None, "branch": None, "commit": None, "compose_files": {}}
    return {
        "available": True,
        "path": display_path(upstream, repo_root),
        "branch": git_output(upstream, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "commit": git_output(upstream, ["rev-parse", "--short", "HEAD"]),
        "compose_files": {name: display_path(upstream / rel, repo_root) for name, rel in UPSTREAM_COMPOSE.items()},
    }


def has_nvidia_api_key() -> bool:
    return bool(os.environ.get("NVIDIA_API_KEY") or os.environ.get("NVIDIA_API_KEY_FILE"))


def read_secret(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    file_name = f"{name}_FILE"
    if os.environ.get(file_name):
        return Path(os.environ[file_name]).expanduser().read_text(encoding="utf-8").strip()
    raise RuntimeError(f"{name} or {file_name} is required")


def env_value(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError("Secret values for Docker env files must be single-line.")
    return value


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


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


def git_output(repo: Path, args: list[str]) -> str | None:
    result = run_command(["git", "-C", str(repo), *args], timeout=10)
    return result["stdout"].strip() if result["ok"] and result["stdout"].strip() else None


def redact_command(command: list[str]) -> list[str]:
    return [item if not any(secret in item.upper() for secret in ("KEY", "TOKEN", "SECRET")) else "<redacted>" for item in command]


def tail(value: str, max_chars: int = 2000) -> str:
    return value[-max_chars:]


def display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root))
    except ValueError:
        return str(path).replace(str(Path.home()), "~")


def write_reports(report: dict[str, Any], json_path: Path, md_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# NVIDIA Content Agents deployment plan",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Action: `{report['action']}`",
        f"- Passed: `{report['passed']}`",
        f"- Upstream: `{report['content_agents_upstream'].get('path') or 'none'}` @ `{report['content_agents_upstream'].get('commit') or 'none'}`",
        f"- Runtime dir: `{report['runtime_dir']}`",
        f"- Endpoint env: `{report['endpoint_env_path']}`",
        f"- Secret handling: {report['secret_handling']}",
        f"- GPU assignment: `{report['gpu_assignment'].get('policy')}`; material OVRTX=`{report['gpu_assignment'].get('material_ovrtx_visible_devices') or 'not pinned'}`, physics OVRTX=`{report['gpu_assignment'].get('physics_ovrtx_visible_devices') or 'not pinned'}`",
        "",
        "## Blockers",
        "",
    ]
    if report["blockers"]:
        lines.extend(f"- {blocker}" for blocker in report["blockers"])
    else:
        lines.append("- none")
    lines.extend(["", "## Endpoints after `up`", "", "| Service | URL |", "| --- | --- |"])
    for name, url in report["endpoints_after_up"].items():
        lines.append(f"| `{name}` | `{url}` |")
    lines.extend(["", "## Redacted NVIDIA env", "", "| Variable | State |", "| --- | --- |"])
    for name, state in report["redacted_environment"].items():
        lines.append(f"| `{name}` | `{state}` |")
    lines.extend(["", "## Planned commands", ""])
    for group, commands in report["commands"].items():
        lines.append(f"### {group}")
        lines.extend(f"- `{command}`" for command in commands)
        lines.append("")
    lines.append("After both Material and Physics endpoints are healthy, export the endpoint URLs and run `npm run nvidia:content-agents`, then rerun `npm run nvidia:simready`.")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
