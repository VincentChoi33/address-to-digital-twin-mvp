#!/usr/bin/env python3
"""Run or audit NVIDIA Omniverse Content Agents material/physics assignment.

The script never fakes a Content Agents pass: without service endpoints/auth it writes a
blocked report. With endpoints and the NVIDIA reference router available, it delegates to
that router and preserves its material/physics USD outputs and reports.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

DEFAULT_PROJECT_ID = "sadang_317_6"
MATERIAL_ENDPOINT_ENVS = ("CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL", "MATERIAL_AGENT_BASE_URL")
PHYSICS_ENDPOINT_ENVS = ("CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL", "PHYSICS_AGENT_BASE_URL")
OVRTX_ENDPOINT_ENVS = ("CONTENT_AGENTS_OVRTX_BASE_URL", "OVRTX_RENDER_ENDPOINT", "RENDER_ENDPOINT")
TOKEN_ENVS = (
    "CONTENT_AGENTS_TOKEN",
    "CONTENT_AGENTS_MATERIAL_AGENT_TOKEN",
    "CONTENT_AGENTS_PHYSICS_AGENT_TOKEN",
    "NGC_API_KEY",
    "NVCF_API_KEY",
)
DEPLOYMENT_AUTH_ENVS = ("NVIDIA_API_KEY",)
ROUTER_CANDIDATES = (
    "~/.codex/.tmp/plugins/plugins/nvidia/skills/omniverse-cad-to-simready/references/content-agents/scripts/run.py",
    "~/.codex/plugins/cache/nvidia/skills/omniverse-cad-to-simready/references/content-agents/scripts/run.py",
)
def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run/audit NVIDIA Omniverse Content Agents on the generated USD asset.")
    parser.add_argument("--package-dir", default=f"src/samples/{DEFAULT_PROJECT_ID}/omniverse")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--asset", default=None, help="USD input. Defaults to the self-contained SimReady asset source.")
    parser.add_argument("--output-dir", default=None, help="Output directory for Content Agents run artifacts.")
    parser.add_argument("--output-json", default="docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.json")
    parser.add_argument("--output-md", default="docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.md")
    parser.add_argument("--router", default=os.environ.get("NVIDIA_CONTENT_AGENTS_ROUTER"))
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--request-timeout", type=int, default=120)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--require-auth", action="store_true", default=env_truthy("CONTENT_AGENTS_REQUIRE_AUTH"), help="Block unless a Content Agents usage token is present. Existing local endpoints may not require this.")
    parser.add_argument("--require-render-endpoint", action="store_true", default=env_truthy("CONTENT_AGENTS_REQUIRE_RENDER_ENDPOINT"), help="Block unless OVRTX/render endpoint is present.")
    parser.add_argument("--convert-physics-output-to-usd", action=argparse.BooleanOptionalAction, default=True, help="Ask the reference router to convert Physics Agent output to USD for downstream SimReady validation.")
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 for blocked prerequisite reports.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    package_dir = (repo_root / args.package_dir).resolve()
    asset = Path(args.asset).resolve() if args.asset else package_dir / "simready_asset" / args.project_id / "simready_usd" / f"{args.project_id}.usda"
    output_dir = Path(args.output_dir).resolve() if args.output_dir else package_dir / "content_agents_run"
    report_path = (repo_root / args.output_json).resolve()
    markdown_path = (repo_root / args.output_md).resolve()
    router = resolve_router(args.router)
    upstream = resolve_content_agents_upstream()

    report = base_report(args.project_id, asset, output_dir, router, repo_root)
    endpoint_state = endpoint_status()
    report["redacted_environment"] = endpoint_state["redacted_environment"]
    report["provided_endpoints"] = endpoint_state["provided_endpoints"]
    report["auth_policy"] = {
        "usage_token_required": bool(args.require_auth),
        "render_endpoint_required": bool(args.require_render_endpoint),
        "usage_auth_present": endpoint_state["has_usage_token"],
        "deployment_auth_present": endpoint_state["has_deployment_auth"],
        "note": "Provided local/service endpoints may manage auth themselves; deployment of missing services requires NVIDIA_API_KEY.",
    }
    report["deployment_handoffs"] = deployment_handoffs(endpoint_state)
    report["content_agents_upstream"] = upstream_report(upstream, repo_root)
    report["router"] = {
        "path": display_path(router, repo_root) if router else None,
        "available": bool(router and router.is_file()),
        "source": router_source(router),
    }

    blockers: list[str] = []
    if not asset.is_file():
        blockers.append(f"USD asset does not exist: {asset}")
    if not endpoint_state["has_material_endpoint"]:
        blockers.append("Missing Material Agent endpoint: set CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL or MATERIAL_AGENT_BASE_URL.")
    if not endpoint_state["has_physics_endpoint"]:
        blockers.append("Missing Physics Agent endpoint: set CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL or PHYSICS_AGENT_BASE_URL.")
    if args.require_render_endpoint and not endpoint_state["has_ovrtx_endpoint"]:
        blockers.append("Missing required OVRTX/render endpoint: set CONTENT_AGENTS_OVRTX_BASE_URL, OVRTX_RENDER_ENDPOINT, or RENDER_ENDPOINT.")
    if args.require_auth and not endpoint_state["has_usage_token"]:
        blockers.append("Missing required Content Agents usage token/key: set CONTENT_AGENTS_TOKEN, service-specific token, NGC_API_KEY, or NVCF_API_KEY.")
    if report["deployment_handoffs"] and not endpoint_state["has_deployment_auth"]:
        blockers.append("Missing NVIDIA_API_KEY for deploying missing Content Agents services from NVIDIA build/upstream deployment skills.")
    if report["deployment_handoffs"] and not upstream:
        blockers.append("NVIDIA Content Agents upstream checkout not found; set CONTENT_AGENTS_UPSTREAM_ROOT or PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT for deployment handoff docs.")
    if not router or not router.is_file():
        report["router"]["fallback"] = "direct-rest-client"

    if blockers:
        report.update({"status": "blocked", "passed": False, "blockers": blockers, "next_step": "provide-content-agents-endpoints-and-auth"})
        write_reports(report, report_path, markdown_path)
        print(json.dumps({"status": report["status"], "output_json": str(report_path), "output_md": str(markdown_path), "blockers": blockers}, indent=2))
        return 0 if args.allow_blocked else 2

    output_dir.mkdir(parents=True, exist_ok=True)
    if router and router.is_file():
        child_report, completed, command = run_reference_router(args, router, asset, output_dir, repo_root)
        passed = completed.returncode == 0 and bool(child_report.get("passed"))
        router_report = output_dir / "content-agents-router.json"
        router_md = output_dir / "content-agents-router.md"
    else:
        child_report = run_direct_rest(args, asset, output_dir)
        completed = subprocess.CompletedProcess(args=["direct-rest-client"], returncode=0 if child_report.get("passed") else 1, stdout="", stderr="")
        command = ["direct-rest-client", endpoint_state["provided_endpoints"].get("material") or "material", endpoint_state["provided_endpoints"].get("physics") or "physics"]
        passed = bool(child_report.get("passed"))
        router_report = output_dir / "content-agents-rest-client.json"
        router_md = output_dir / "content-agents-rest-client.md"
        router_report.write_text(json.dumps(child_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        router_md.write_text(render_child_markdown(child_report), encoding="utf-8")
    report.update(
        {
            "status": "passed" if passed else "failed",
            "passed": passed,
            "blockers": [],
            "router_report": str(router_report),
            "router_markdown_report": str(router_md),
            "router_exit_status": completed.returncode,
            "router_stdout_tail": tail(completed.stdout),
            "router_stderr_tail": tail(completed.stderr),
            "materialized_usd_path": child_report.get("materialized_usd_path"),
            "physics_usd_path": child_report.get("physics_usd_path"),
            "output_usd_path": child_report.get("output_usd_path"),
            "steps": child_report.get("steps", []),
            "errors": child_report.get("errors", []),
            "warnings": child_report.get("warnings", []),
            "next_step": "rerun-simready-validation-on-content-agents-output" if passed else "fix-content-agents-runtime",
            "command": redact_paths(command, repo_root),
        }
    )
    write_reports(report, report_path, markdown_path)
    print(json.dumps({"status": report["status"], "output_json": str(report_path), "output_md": str(markdown_path)}, indent=2))
    return 0 if passed else 1


def base_report(project_id: str, asset: Path, output_dir: Path, router: Path | None, repo_root: Path) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "skill": "content-agents",
        "status": "not_run",
        "passed": False,
        "input_usd_path": display_path(asset, repo_root),
        "output_dir": display_path(output_dir, repo_root),
        "selected_calls": ["material", "physics"],
        "blockers": [],
        "materialized_usd_path": None,
        "physics_usd_path": None,
        "output_usd_path": display_path(asset, repo_root),
        "next_step": "provide-content-agents-endpoints-and-auth",
    }


def run_reference_router(
    args: argparse.Namespace,
    router: Path,
    asset: Path,
    output_dir: Path,
    repo_root: Path,
) -> tuple[dict[str, Any], subprocess.CompletedProcess[str], list[str]]:
    router_report = output_dir / "content-agents-router.json"
    router_md = output_dir / "content-agents-router.md"
    command = [
        sys.executable,
        str(router),
        str(asset),
        "--output-dir",
        str(output_dir),
        "--material",
        "--physics",
        "--report",
        str(router_report),
        "--markdown-report",
        str(router_md),
        "--timeout",
        str(args.timeout),
        "--request-timeout",
        str(args.request_timeout),
        "--poll-interval",
        str(args.poll_interval),
    ]
    if args.convert_physics_output_to_usd:
        command.append("--convert-physics-output-to-usd")
    completed = subprocess.run(command, text=True, capture_output=True)
    return load_json(router_report), completed, command


def run_direct_rest(args: argparse.Namespace, asset: Path, output_dir: Path) -> dict[str, Any]:
    material_base = first_env(MATERIAL_ENDPOINT_ENVS)
    physics_base = first_env(PHYSICS_ENDPOINT_ENVS)
    assert material_base and physics_base
    steps: list[dict[str, Any]] = []
    errors: list[str] = []
    output_dir.mkdir(parents=True, exist_ok=True)

    material_dir = output_dir / "material"
    physics_dir = output_dir / "physics"
    material_dir.mkdir(parents=True, exist_ok=True)
    physics_dir.mkdir(parents=True, exist_ok=True)

    material = run_service_pipeline(
        name="material",
        base_url=material_base,
        usd_path=asset,
        output_dir=material_dir,
        fields={
            "user_email": "address-twin@example.invalid",
            "render_num_workers": "1",
        },
        artifact_candidates=("output",),
        artifact_name="materialized.usd",
        timeout=args.timeout,
        poll_interval=args.poll_interval,
        request_timeout=args.request_timeout,
    )
    steps.append(material)
    if not material["passed"]:
        errors.extend(material.get("errors", []))
        return direct_report(False, steps, errors, materialized_usd_path=None, physics_usd_path=None)

    materialized = Path(material["output_path"]) if material.get("output_path") else asset
    physics = run_service_pipeline(
        name="physics",
        base_url=physics_base,
        usd_path=materialized,
        output_dir=physics_dir,
        fields={
            "render_backend": "remote",
            "optimize_usd": "false",
        },
        artifact_candidates=("output-usd", "output"),
        artifact_name="physics.usd",
        timeout=args.timeout,
        poll_interval=args.poll_interval,
        request_timeout=args.request_timeout,
    )
    steps.append(physics)
    if not physics["passed"]:
        errors.extend(physics.get("errors", []))
    return direct_report(
        bool(material["passed"] and physics["passed"]),
        steps,
        errors,
        materialized_usd_path=material.get("output_path"),
        physics_usd_path=physics.get("output_path"),
    )


def run_service_pipeline(
    name: str,
    base_url: str,
    usd_path: Path,
    output_dir: Path,
    fields: dict[str, str],
    artifact_candidates: tuple[str, ...],
    artifact_name: str,
    timeout: int,
    poll_interval: float,
    request_timeout: int,
) -> dict[str, Any]:
    started = time.monotonic()
    step: dict[str, Any] = {
        "name": name,
        "base_url": base_url,
        "input_usd": str(usd_path),
        "status": "not_started",
        "passed": False,
        "errors": [],
    }
    try:
        health = get_json(urljoin(base_url.rstrip("/") + "/", "health"), request_timeout)
        step["health"] = health
        response = post_multipart(
            urljoin(base_url.rstrip("/") + "/", "pipeline"),
            fields=fields,
            file_field="usd_file",
            file_path=usd_path,
            timeout=request_timeout,
        )
        session_id = response.get("session_id")
        if not session_id:
            raise RuntimeError(f"{name} pipeline response did not include session_id: {response}")
        step["session_id"] = session_id
        step["create_response"] = response
        status = poll_pipeline_status(base_url, session_id, timeout, poll_interval, request_timeout)
        step["final_status"] = status
        if status.get("status") != "completed":
            step["status"] = "failed"
            step["errors"].append(f"{name} pipeline did not complete: {status}")
            return step
        output_path = output_dir / artifact_name
        downloaded = download_first_artifact(base_url, session_id, artifact_candidates, output_path, request_timeout)
        step["artifact"] = downloaded
        if not downloaded.get("ok"):
            step["status"] = "failed"
            step["errors"].append(f"{name} output artifact was not downloadable: {downloaded}")
            return step
        step["status"] = "passed"
        step["passed"] = True
        step["output_path"] = str(output_path)
        step["elapsed_seconds"] = round(time.monotonic() - started, 3)
        return step
    except Exception as exc:
        step["status"] = "failed"
        step["errors"].append(f"{type(exc).__name__}: {exc}")
        step["elapsed_seconds"] = round(time.monotonic() - started, 3)
        return step


def poll_pipeline_status(base_url: str, session_id: str, timeout: int, poll_interval: float, request_timeout: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    status: dict[str, Any] = {}
    while time.monotonic() < deadline:
        status = get_json(urljoin(base_url.rstrip("/") + "/", f"pipeline/{session_id}/status"), request_timeout)
        if status.get("status") in {"completed", "failed", "cancelled"}:
            return status
        time.sleep(max(0.5, poll_interval))
    status["status"] = status.get("status", "timeout")
    status["timeout_seconds"] = timeout
    return status


def post_multipart(url: str, fields: dict[str, str], file_field: str, file_path: Path, timeout: int) -> dict[str, Any]:
    boundary = f"----address-twin-{int(time.time() * 1000)}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode(),
                b"\r\n",
            ]
        )
    chunks.extend(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            file_path.read_bytes(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    body = b"".join(chunks)
    request = Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    return json_request(request, timeout)


def get_json(url: str, timeout: int) -> dict[str, Any]:
    return json_request(Request(url, method="GET"), timeout)


def json_request(request: Request, timeout: int) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {request.full_url}: {tail(body, 1000)}") from exc
    except URLError as exc:
        raise RuntimeError(f"URL error for {request.full_url}: {exc.reason}") from exc
    try:
        parsed = json.loads(body)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except json.JSONDecodeError:
        return {"body": body}


def download_first_artifact(base_url: str, session_id: str, candidates: tuple[str, ...], output_path: Path, timeout: int) -> dict[str, Any]:
    errors: list[str] = []
    for artifact in candidates:
        url = urljoin(base_url.rstrip("/") + "/", f"artifacts/{session_id}/{artifact}")
        try:
            with urlopen(Request(url, method="GET"), timeout=timeout) as response:
                output_path.write_bytes(response.read())
            return {"ok": True, "url": url, "path": str(output_path), "bytes": output_path.stat().st_size}
        except Exception as exc:
            errors.append(f"{artifact}: {type(exc).__name__}: {exc}")
    return {"ok": False, "errors": errors}


def direct_report(
    passed: bool,
    steps: list[dict[str, Any]],
    errors: list[str],
    materialized_usd_path: str | None,
    physics_usd_path: str | None,
) -> dict[str, Any]:
    return {
        "client": "direct-rest-client",
        "passed": passed,
        "status": "passed" if passed else "failed",
        "steps": steps,
        "errors": errors,
        "warnings": [],
        "materialized_usd_path": materialized_usd_path,
        "physics_usd_path": physics_usd_path,
        "output_usd_path": physics_usd_path or materialized_usd_path,
    }


def render_child_markdown(report: dict[str, Any]) -> str:
    lines = ["# NVIDIA Content Agents direct REST client", "", f"Status: **{report.get('status')}**", "", "## Steps", ""]
    for step in report.get("steps", []):
        lines.append(f"- `{step.get('name')}`: `{step.get('status')}` session=`{step.get('session_id')}`")
    if report.get("errors"):
        lines.extend(["", "## Errors", ""])
        lines.extend(f"- {error}" for error in report["errors"])
    lines.append("")
    return "\n".join(lines)


def endpoint_status() -> dict[str, Any]:
    envs = [*MATERIAL_ENDPOINT_ENVS, *PHYSICS_ENDPOINT_ENVS, *OVRTX_ENDPOINT_ENVS, *TOKEN_ENVS, *DEPLOYMENT_AUTH_ENVS]
    file_envs = [f"{name}_FILE" for name in [*TOKEN_ENVS, *DEPLOYMENT_AUTH_ENVS]]
    redacted = {name: "present" if os.environ.get(name) else "missing" for name in envs}
    redacted.update({name: "present" if os.environ.get(name) else "missing" for name in file_envs})
    return {
        "redacted_environment": redacted,
        "provided_endpoints": {
            "material": present_name(MATERIAL_ENDPOINT_ENVS),
            "physics": present_name(PHYSICS_ENDPOINT_ENVS),
            "ovrtx_render": present_name(OVRTX_ENDPOINT_ENVS),
            "usage_auth": present_name((*TOKEN_ENVS, *(f"{name}_FILE" for name in TOKEN_ENVS))),
            "deployment_auth": present_name((*DEPLOYMENT_AUTH_ENVS, *(f"{name}_FILE" for name in DEPLOYMENT_AUTH_ENVS))),
        },
        "has_material_endpoint": any(os.environ.get(name) for name in MATERIAL_ENDPOINT_ENVS),
        "has_physics_endpoint": any(os.environ.get(name) for name in PHYSICS_ENDPOINT_ENVS),
        "has_ovrtx_endpoint": any(os.environ.get(name) for name in OVRTX_ENDPOINT_ENVS),
        "has_usage_token": any(os.environ.get(name) for name in TOKEN_ENVS) or any(os.environ.get(f"{name}_FILE") for name in TOKEN_ENVS),
        "has_deployment_auth": any(os.environ.get(name) for name in DEPLOYMENT_AUTH_ENVS) or any(os.environ.get(f"{name}_FILE") for name in DEPLOYMENT_AUTH_ENVS),
    }


def present_name(names: tuple[str, ...]) -> str | None:
    for name in names:
        if os.environ.get(name):
            return name
    return None


def first_env(names: tuple[str, ...]) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def deployment_handoffs(endpoint_state: dict[str, Any]) -> list[dict[str, str]]:
    handoffs: list[dict[str, str]] = []
    if not endpoint_state["has_ovrtx_endpoint"]:
        handoffs.append(
            {
                "target": "ovrtx",
                "upstream_skill": "deploy-ovrtx-docker",
                "reason": "Shared OVRTX renderer is needed before deploying or troubleshooting render-dependent Content Agents services.",
            }
        )
    if not endpoint_state["has_material_endpoint"]:
        handoffs.append(
            {
                "target": "material",
                "upstream_skill": "deploy-material-agent-docker",
                "reason": "Material Agent endpoint is missing for visual material assignment.",
            }
        )
    if not endpoint_state["has_physics_endpoint"]:
        handoffs.append(
            {
                "target": "physics",
                "upstream_skill": "deploy-physics-agent-docker",
                "reason": "Physics Agent endpoint is missing for physics property assignment.",
            }
        )
    return handoffs


def resolve_content_agents_upstream() -> Path | None:
    candidates: list[Path] = []
    explicit = os.environ.get("CONTENT_AGENTS_UPSTREAM_ROOT")
    if explicit:
        candidates.append(Path(explicit).expanduser())
    hub_root = os.environ.get("PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT")
    if hub_root:
        candidates.append(Path(hub_root).expanduser() / "content-agents")
    candidates.append(Path.home() / ".physical-ai-skill-hub/upstreams/content-agents")
    for candidate in candidates:
        if (candidate / ".git").is_dir() and (candidate / ".agents/skills").is_dir():
            return candidate.resolve()
    return None


def upstream_report(upstream: Path | None, repo_root: Path) -> dict[str, Any]:
    if not upstream:
        return {
            "available": False,
            "path": None,
            "commit": None,
            "branch": None,
            "deployment_skill_paths": {},
        }
    return {
        "available": True,
        "path": display_path(upstream, repo_root),
        "commit": git_output(upstream, ["rev-parse", "--short", "HEAD"]),
        "branch": git_output(upstream, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "deployment_skill_paths": {
            "ovrtx": display_path(upstream / ".agents/skills/deploy-ovrtx-docker/SKILL.md", repo_root),
            "material": display_path(upstream / ".agents/skills/deploy-material-agent-docker/SKILL.md", repo_root),
            "physics": display_path(upstream / ".agents/skills/deploy-physics-agent-docker/SKILL.md", repo_root),
        },
    }


def git_output(repo: Path, args: list[str]) -> str | None:
    try:
        completed = subprocess.run(["git", "-C", str(repo), *args], text=True, capture_output=True, timeout=10)
    except Exception:
        return None
    value = completed.stdout.strip()
    return value if completed.returncode == 0 and value else None


def resolve_router(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    skill_root = os.environ.get("NVIDIA_CONTENT_AGENTS_SKILL_ROOT")
    if skill_root:
        candidates.append(Path(skill_root).expanduser() / "scripts/run.py")
    candidates.extend(Path(path).expanduser() for path in ROUTER_CANDIDATES)
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return candidates[0].resolve() if explicit else None


def router_source(router: Path | None) -> str | None:
    if not router:
        return None
    value = str(router)
    if "/.codex/" in value:
        return "local-codex-nvidia-plugin"
    if "content-agents" in value:
        return "content-agents-reference"
    return "explicit"


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except FileNotFoundError:
        return {}


def redact_paths(command: list[str], repo_root: Path) -> list[str]:
    home = str(Path.home())
    root = str(repo_root)
    return [item.replace(root, ".").replace(home, "~") for item in command]


def display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root))
    except ValueError:
        return str(path).replace(str(Path.home()), "~")


def tail(value: str, max_chars: int = 4000) -> str:
    return value[-max_chars:]


def write_reports(report: dict[str, Any], json_path: Path, md_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# NVIDIA Content Agents run — {report['project_id']}",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Passed: `{report['passed']}`",
        f"- Input USD: `{report['input_usd_path']}`",
        f"- Output dir: `{report['output_dir']}`",
        f"- Router available: `{report.get('router', {}).get('available')}`",
        f"- Materialized USD: `{report.get('materialized_usd_path') or 'none'}`",
        f"- Physics USD: `{report.get('physics_usd_path') or 'none'}`",
        f"- Next step: `{report['next_step']}`",
        f"- Usage token required: `{(report.get('auth_policy') or {}).get('usage_token_required')}`",
        f"- Render endpoint required: `{(report.get('auth_policy') or {}).get('render_endpoint_required')}`",
        f"- Upstream checkout: `{(report.get('content_agents_upstream') or {}).get('path') or 'none'}`",
        "",
    ]
    blockers = report.get("blockers") or []
    if blockers:
        lines.extend(["## Blockers", ""])
        lines.extend(f"- {blocker}" for blocker in blockers)
        lines.append("")
    handoffs = report.get("deployment_handoffs") or []
    if handoffs:
        lines.extend(["## Deployment handoffs", ""])
        for handoff in handoffs:
            lines.append(f"- `{handoff['target']}` → `{handoff['upstream_skill']}`: {handoff['reason']}")
        lines.append("")
    lines.extend(
        [
            "## Provided endpoints",
            "",
            "| Endpoint | Source env |",
            "| --- | --- |",
        ]
    )
    for name, state in sorted((report.get("provided_endpoints") or {}).items()):
        lines.append(f"| `{name}` | `{state or 'missing'}` |")
    lines.extend(
        [
            "",
            "## Redacted environment",
            "",
            "| Variable | State |",
            "| --- | --- |",
        ]
    )
    for name, state in sorted((report.get("redacted_environment") or {}).items()):
        lines.append(f"| `{name}` | `{state}` |")
    lines.append("")
    if report.get("status") == "passed":
        lines.append("This report was produced by real NVIDIA Content Agents Material→Physics services; it does not use browser-side or mock material/physics assignment.")
    else:
        lines.append("This report is blocked until real NVIDIA Content Agents endpoints or deployment prerequisites are provided; it does not substitute browser or mock material/physics assignment.")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
