#!/usr/bin/env python3
"""One-shot NVIDIA-only finish runner.

When real NVIDIA Content Agents endpoints or `NVIDIA_API_KEY(_FILE)` are
available, this runs the remaining finalization chain:

deploy plan/status → optional deploy up → Content Agents Material→Physics →
SimReady validation → NVIDIA-only acceptance certificate.

Without the missing credential/endpoints it writes a precise blocked report and
returns 0 only when `--allow-blocked` is used.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
from typing import Any

DEFAULT_PROJECT_ID = "sadang_317_6"
DEFAULT_OUTPUT_JSON = "docs/evidence/nvidia-finish-sadang-2026-06-13.json"
DEFAULT_OUTPUT_MD = "docs/evidence/nvidia-finish-sadang-2026-06-13.md"
DEFAULT_SCRATCH_DIR = ".tmp/nvidia-finish"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the remaining NVIDIA-only finish chain.")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--output-json", default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", default=DEFAULT_OUTPUT_MD)
    parser.add_argument("--scratch-dir", default=DEFAULT_SCRATCH_DIR)
    parser.add_argument("--wait-seconds", type=int, default=900)
    parser.add_argument("--skip-docker-gpu-smoke", action="store_true")
    parser.add_argument("--persist-intermediate", action="store_true", help="Write Content Agents/SimReady/acceptance reports to docs/evidence instead of scratch.")
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 for the current explicit blocked state.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    scratch_dir = (repo_root / args.scratch_dir).resolve()
    scratch_dir.mkdir(parents=True, exist_ok=True)
    context = FinishContext(args=args, repo_root=repo_root, scratch_dir=scratch_dir)
    report = run_finish(context)
    write_reports(report, Path(args.output_json), Path(args.output_md))
    print(json.dumps({"status": report["status"], "output_json": args.output_json, "output_md": args.output_md, "blockers": report["blockers"]}, indent=2))
    return 0 if report["status"] == "passed" or (args.allow_blocked and report["status"] == "blocked") else 2


class FinishContext:
    def __init__(self, args: argparse.Namespace, repo_root: Path, scratch_dir: Path) -> None:
        self.args = args
        self.repo_root = repo_root
        self.scratch_dir = scratch_dir

    def report_path(self, name: str, suffix: str) -> str:
        if self.args.persist_intermediate:
            mapping = {
                ("content-agents", "json"): "docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.json",
                ("content-agents", "md"): "docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.md",
                ("simready", "json"): "docs/evidence/nvidia-simready-validate-sadang-2026-06-12.json",
                ("simready", "md"): "docs/evidence/nvidia-simready-validate-sadang-2026-06-12.md",
                ("acceptance", "json"): "docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.json",
                ("acceptance", "md"): "docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.md",
            }
            if (name, suffix) in mapping:
                return mapping[(name, suffix)]
        return str(self.scratch_dir / f"{name}.{suffix}")


def run_finish(context: FinishContext) -> dict[str, Any]:
    env = os.environ.copy()
    external_endpoints_present = has_endpoint_environment(env)
    steps: list[dict[str, Any]] = []
    blockers: list[str] = []
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

    deploy_plan_args = [
        "python3",
        "scripts/nvidia_content_agents_deploy.py",
        "plan",
        "--allow-blocked",
        "--output-json",
        str(context.scratch_dir / "deploy-plan.json"),
        "--output-md",
        str(context.scratch_dir / "deploy-plan.md"),
    ]
    if context.args.skip_docker_gpu_smoke:
        deploy_plan_args.append("--skip-docker-gpu-smoke")
    steps.append(run_step("content-agents-deploy-plan", deploy_plan_args, env=env))
    deploy_plan = load_json(context.scratch_dir / "deploy-plan.json")

    endpoints_env = endpoint_env_path(deploy_plan)

    deploy_status_args = [
        "python3",
        "scripts/nvidia_content_agents_deploy.py",
        "status",
        "--allow-blocked",
        "--wait-seconds",
        str(context.args.wait_seconds if has_endpoint_environment(env) else 0),
        "--output-json",
        str(context.scratch_dir / "deploy-status.json"),
        "--output-md",
        str(context.scratch_dir / "deploy-status.md"),
    ]
    steps.append(run_step("content-agents-deploy-status", deploy_status_args, env=env))
    deploy_status = load_json(context.scratch_dir / "deploy-status.json")
    if deploy_status.get("status") == "ready" and endpoints_env:
        env.update(load_endpoint_env(endpoints_env))

    if deploy_status.get("status") != "ready" and has_nvidia_deployment_auth(env):
        deploy_up_args = [
            "python3",
            "scripts/nvidia_content_agents_deploy.py",
            "up",
            "--wait-seconds",
            str(context.args.wait_seconds),
            "--output-json",
            str(context.scratch_dir / "deploy-up.json"),
            "--output-md",
            str(context.scratch_dir / "deploy-up.md"),
        ]
        if context.args.skip_docker_gpu_smoke:
            deploy_up_args.append("--skip-docker-gpu-smoke")
        steps.append(run_step("content-agents-deploy-up", deploy_up_args, env=env, timeout=max(1800, context.args.wait_seconds + 1200)))
        deploy_up = load_json(context.scratch_dir / "deploy-up.json")
        endpoints_env = endpoint_env_path(deploy_up) or endpoints_env
        if deploy_up.get("status") == "ready" and endpoints_env:
            env.update(load_endpoint_env(endpoints_env))
        deploy_status = deploy_up
    elif deploy_status.get("status") != "ready":
        blockers.append("Content Agents endpoints are not ready and NVIDIA_API_KEY/NVIDIA_API_KEY_FILE is not present for automatic deployment.")

    should_run_content_agents = external_endpoints_present or deploy_status.get("status") == "ready"
    if should_run_content_agents and has_endpoint_environment(env):
        content_agents_args = [
            "python3",
            "scripts/nvidia_content_agents.py",
            "--allow-blocked",
            "--output-json",
            context.report_path("content-agents", "json"),
            "--output-md",
            context.report_path("content-agents", "md"),
        ]
        steps.append(run_step("content-agents-run", content_agents_args, env=env, timeout=2400))
        content_agents = load_json(Path(context.report_path("content-agents", "json")))
        if content_agents.get("status") != "passed":
            blockers.extend(content_agents.get("blockers") or content_agents.get("errors") or ["Content Agents Material→Physics assignment did not pass."])
    else:
        content_agents = {"status": "blocked", "blockers": ["Content Agents endpoints are not ready; skipping Material→Physics assignment instead of calling dead generated endpoints."]}
        steps.append(skipped_step("content-agents-run", "Skipped until Material/Physics endpoints are healthy or explicitly provided."))
        blockers.extend(content_agents["blockers"])

    if content_agents.get("status") == "passed":
        simready_args = [
            "python3",
            "scripts/nvidia_simready_validate.py",
            "--output-json",
            context.report_path("simready", "json"),
            "--output-md",
            context.report_path("simready", "md"),
        ]
        steps.append(run_step("simready-validate", simready_args, env=env, timeout=1800))
    else:
        steps.append(skipped_step("simready-validate", "Skipped until Content Agents Material→Physics assignment passes."))

    acceptance_args = [
        "python3",
        "scripts/nvidia_acceptance.py",
        "--allow-blocked",
        "--output-json",
        context.report_path("acceptance", "json"),
        "--output-md",
        context.report_path("acceptance", "md"),
    ]
    steps.append(run_step("nvidia-acceptance", acceptance_args, env=env))
    acceptance = load_json(Path(context.report_path("acceptance", "json")))
    if acceptance.get("status") != "passed":
        blockers.extend(acceptance.get("blockers") or ["NVIDIA-only acceptance certificate did not pass."])

    status = "passed" if acceptance.get("status") == "passed" and not blockers else "blocked"
    return {
        "project_id": context.args.project_id,
        "generated_at": generated_at,
        "status": status,
        "passed": status == "passed",
        "secret_handling": "No secret values are printed; child commands receive environment only.",
        "persist_intermediate": bool(context.args.persist_intermediate),
        "scratch_dir": display_path(context.scratch_dir, context.repo_root),
        "steps": steps,
        "blockers": dedupe(blockers),
        "next_commands": [
            "NVIDIA_API_KEY_FILE=/secure/path/nvidia_api_key npm run nvidia:finish",
            "npm run nvidia:acceptance",
        ],
    }


def run_step(name: str, command: list[str], env: dict[str, str], timeout: int = 1800) -> dict[str, Any]:
    try:
        completed = subprocess.run(command, text=True, capture_output=True, env=env, timeout=timeout)
        return {
            "name": name,
            "status": "passed" if completed.returncode == 0 else "failed",
            "exit_code": completed.returncode,
            "command": redact_command(command),
            "stdout_tail": tail(completed.stdout),
            "stderr_tail": tail(completed.stderr),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "name": name,
            "status": "failed",
            "exit_code": None,
            "command": redact_command(command),
            "stdout_tail": tail(exc.stdout or ""),
            "stderr_tail": f"timeout after {timeout}s",
        }


def skipped_step(name: str, reason: str) -> dict[str, Any]:
    return {"name": name, "status": "skipped", "reason": reason}


def endpoint_env_path(report: dict[str, Any]) -> Path | None:
    value = report.get("endpoint_env_path")
    if not isinstance(value, str) or not value:
        return None
    return Path(value).expanduser()


def load_endpoint_env(path: Path | None) -> dict[str, str]:
    if not path or not path.is_file():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def has_endpoint_environment(env: dict[str, str]) -> bool:
    return bool(
        (env.get("CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL") or env.get("MATERIAL_AGENT_BASE_URL"))
        and (env.get("CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL") or env.get("PHYSICS_AGENT_BASE_URL"))
    )


def has_nvidia_deployment_auth(env: dict[str, str]) -> bool:
    return bool(env.get("NVIDIA_API_KEY") or env.get("NVIDIA_API_KEY_FILE"))


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except FileNotFoundError:
        return {}


def redact_command(command: list[str]) -> list[str]:
    return [item if not any(secret in item.upper() for secret in ("KEY", "TOKEN", "SECRET")) else "<redacted>" for item in command]


def tail(value: str, max_chars: int = 3000) -> str:
    return value[-max_chars:]


def dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root))
    except ValueError:
        return str(path)


def write_reports(report: dict[str, Any], json_path: Path, md_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# NVIDIA finish report",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Project: `{report['project_id']}`",
        f"- Scratch dir: `{report['scratch_dir']}`",
        f"- Persist intermediate evidence: `{report['persist_intermediate']}`",
        f"- Secret handling: {report['secret_handling']}",
        "",
        "## Steps",
        "",
        "| Step | Status | Exit |",
        "| --- | --- | --- |",
    ]
    for step in report["steps"]:
        lines.append(f"| `{step['name']}` | `{step['status']}` | `{step.get('exit_code', '')}` |")
    if report["blockers"]:
        lines.extend(["", "## Blockers", ""])
        lines.extend(f"- {blocker}" for blocker in report["blockers"])
    lines.extend(["", "## Next commands", ""])
    lines.extend(f"- `{command}`" for command in report["next_commands"])
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
