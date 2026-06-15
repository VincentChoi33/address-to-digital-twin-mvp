#!/usr/bin/env python3
"""Run NVIDIA SimReady Foundation profile validation for the generated package.

This script intentionally keeps Content Agents separate: it validates the authored,
self-contained SimReady asset source when the official `simready-validate` tool and
SimReady Foundation rules/profiles are available (or auto-provisioned in CI).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any

DEFAULT_PROJECT_ID = "sadang_317_6"
DEFAULT_PROFILE = "Prop-Robotics-Neutral"
DEFAULT_PROFILE_VERSION = "1.0.0"
FOUNDATION_REPO = "https://github.com/NVIDIA/simready-foundation.git"


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the NVIDIA SimReady asset-source copy.")
    parser.add_argument("--package-dir", default=f"src/samples/{DEFAULT_PROJECT_ID}/omniverse")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--asset", default=None, help="USD/USDa asset to validate. Defaults to the authored self-contained SimReady asset source.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--version", default=DEFAULT_PROFILE_VERSION)
    parser.add_argument("--output-json", default="docs/evidence/nvidia-simready-validate-sadang-2026-06-12.json")
    parser.add_argument("--output-md", default="docs/evidence/nvidia-simready-validate-sadang-2026-06-12.md")
    parser.add_argument("--raw-output", default=None, help="Optional path for raw simready-validate --output JSON.")
    parser.add_argument("--auto-install", action="store_true", default=env_truthy("NVIDIA_SIMREADY_AUTO_INSTALL"))
    parser.add_argument("--auto-clone", action="store_true", default=env_truthy("NVIDIA_SIMREADY_AUTO_CLONE"))
    args = parser.parse_args()

    repo_root = Path.cwd()
    package_dir = (repo_root / args.package_dir).resolve()
    asset_path = Path(args.asset).expanduser().resolve() if args.asset else package_dir / "simready_asset" / args.project_id / "simready_usd" / f"{args.project_id}.usda"
    if not asset_path.is_file():
        raise SystemExit(f"SimReady asset source is missing: {asset_path}")

    foundation_root = resolve_foundation_root(auto_clone=args.auto_clone)
    validator = resolve_validator(auto_install=args.auto_install)
    raw_output = Path(args.raw_output).resolve() if args.raw_output else Path(tempfile.mkdtemp(prefix="nvidia-simready-")) / "simready-profile-raw.json"
    raw_output.parent.mkdir(parents=True, exist_ok=True)

    command = [
        str(validator),
        str(asset_path),
        "--profile",
        args.profile,
        "--version",
        args.version,
        "--rules-path",
        str(foundation_root / "nv_core/sr_specs/docs/capabilities"),
        "--features-path",
        str(foundation_root / "nv_core/sr_specs/docs/features"),
        "--profiles-path",
        str(foundation_root / "nv_core/sr_specs/docs/profiles/profiles.toml"),
        "--output",
        str(raw_output),
    ]
    result = subprocess.run(command, text=True, capture_output=True)
    raw_report = load_json(raw_output)
    parsed = parse_simready_report(raw_report, str(asset_path))
    passed = result.returncode == 0 and parsed["passed"]

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "status": "passed" if passed else "failed",
        "generated_at": generated_at,
        "project_id": args.project_id,
        "validator_tool": "simready-validate",
        "simready_validate_version": validator_version(validator),
        "foundation_root": display_path(foundation_root, repo_root),
        "foundation_commit": git_short(foundation_root),
        "asset_path": str(asset_path.relative_to(repo_root)) if asset_path.is_relative_to(repo_root) else str(asset_path),
        "profile_target": {"name": args.profile, "version": args.version},
        "feature_results": parsed["feature_results"],
        "failing_requirements": parsed["failing_requirements"],
        "validator_exit_status": result.returncode,
        "command": [redact_text(item, repo_root) for item in command],
        "stdout_tail": redact_text(tail(result.stdout), repo_root),
        "stderr_tail": redact_text(tail(result.stderr), repo_root),
        "raw_output": redact_text(str(raw_output), repo_root),
    }

    output_json = (repo_root / args.output_json).resolve()
    output_md = (repo_root / args.output_md).resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output_md.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps({"status": report["status"], "output_json": str(output_json), "output_md": str(output_md)}, indent=2))
    return 0 if passed else 1


def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def resolve_foundation_root(auto_clone: bool) -> Path:
    candidates = [
        os.environ.get("SIMREADY_FOUNDATION_ROOT"),
        str(Path(os.environ["PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT"]) / "simready-foundation") if os.environ.get("PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT") else None,
        str(Path.home() / ".physical-ai-skill-hub/upstreams/simready-foundation"),
    ]
    for candidate in candidates:
        if candidate and valid_foundation_root(Path(candidate)):
            return Path(candidate).resolve()

    if auto_clone:
        clone_root = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()) / "simready-foundation"
        if not valid_foundation_root(clone_root):
            if clone_root.exists():
                shutil.rmtree(clone_root)
            subprocess.run(["git", "clone", "--depth", "1", FOUNDATION_REPO, str(clone_root)], check=True)
            foundation_ref = os.environ.get("NVIDIA_SIMREADY_FOUNDATION_REF")
            if foundation_ref:
                subprocess.run(["git", "-C", str(clone_root), "fetch", "--depth", "1", "origin", foundation_ref], check=True)
                subprocess.run(["git", "-C", str(clone_root), "checkout", "FETCH_HEAD"], check=True)
        if valid_foundation_root(clone_root):
            return clone_root.resolve()

    raise SystemExit(
        "SimReady Foundation root not found. Set SIMREADY_FOUNDATION_ROOT, "
        "PHYSICAL_AI_SKILL_HUB_UPSTREAM_ROOT, or run with NVIDIA_SIMREADY_AUTO_CLONE=1."
    )


def valid_foundation_root(path: Path) -> bool:
    return (
        path.is_dir()
        and (path / "nv_core/sr_specs/docs/capabilities").is_dir()
        and (path / "nv_core/sr_specs/docs/features").is_dir()
        and (path / "nv_core/sr_specs/docs/profiles/profiles.toml").is_file()
    )


def resolve_validator(auto_install: bool) -> Path:
    explicit = os.environ.get("SIMREADY_VALIDATE_BIN")
    if explicit and Path(explicit).is_file():
        return Path(explicit).resolve()
    found = shutil.which("simready-validate")
    if found:
        return Path(found).resolve()

    tmp_candidates = sorted(
        {
            Path(tempfile.gettempdir()) / "nvidia-simready-validate-venv/bin/simready-validate",
            Path("/tmp") / "nvidia-simready-validate-venv/bin/simready-validate",
            *Path(tempfile.gettempdir()).glob("simready-runner-venv-*/bin/simready-validate"),
            *Path("/tmp").glob("simready-runner-venv-*/bin/simready-validate"),
        },
        reverse=True,
    )
    for candidate in tmp_candidates:
        if candidate.is_file():
            return candidate.resolve()

    if auto_install:
        python = resolve_python()
        venv_dir = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()) / "nvidia-simready-validate-venv"
        validator = venv_dir / "bin/simready-validate"
        if not validator.is_file():
            subprocess.run([str(python), "-m", "venv", str(venv_dir)], check=True)
            pip = venv_dir / "bin/pip"
            subprocess.run([str(pip), "install", "--upgrade", "pip"], check=True)
            subprocess.run([str(pip), "install", "simready-validate>=2026.4.8", "numpy>=1.24,<3"], check=True)
        return validator.resolve()

    raise SystemExit("simready-validate not found. Set SIMREADY_VALIDATE_BIN or run with NVIDIA_SIMREADY_AUTO_INSTALL=1.")


def resolve_python() -> Path:
    candidates = [os.environ.get("NVIDIA_SIMREADY_PYTHON"), "python3.12", "python3", "python"]
    for candidate in candidates:
        if not candidate:
            continue
        found = shutil.which(candidate) if os.sep not in candidate else candidate
        if not found:
            continue
        result = subprocess.run([found, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], text=True, capture_output=True)
        if result.returncode == 0:
            major, minor = [int(part) for part in result.stdout.strip().split(".")[:2]]
            if (major, minor) >= (3, 12):
                return Path(found).resolve()
    raise SystemExit("Python >= 3.12 is required to auto-install simready-validate. Set NVIDIA_SIMREADY_PYTHON.")


def validator_version(validator: Path) -> str:
    python = validator.parent / "python"
    if python.is_file():
        result = subprocess.run([str(python), "-m", "pip", "show", "simready-validate"], text=True, capture_output=True)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("Version:"):
                    return line.split(":", 1)[1].strip()
    result = subprocess.run([str(validator), "--help"], text=True, capture_output=True)
    return "available" if result.returncode == 0 else "unknown"


def git_short(path: Path) -> str | None:
    result = subprocess.run(["git", "-C", str(path), "rev-parse", "--short", "HEAD"], text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def parse_simready_report(raw: Any, asset_path: str) -> dict[str, Any]:
    if isinstance(raw, dict) and asset_path in raw:
        entry = raw[asset_path]
        features = entry.get("features_summary", {})
        feature_results = [
            {
                "feature_id": feature_id,
                "version": value.get("version"),
                "passed": bool(value.get("passed")),
                "dependencies": value.get("dependencies"),
            }
            for feature_id, value in sorted(features.items())
        ]
        return {
            "passed": bool(feature_results) and all(item["passed"] for item in feature_results),
            "feature_results": feature_results,
            "failing_requirements": [],
        }

    if isinstance(raw, dict):
        feature_results = raw.get("feature_results") or []
        failing = raw.get("requirement_counts") or raw.get("errors") or []
        return {"passed": bool(raw.get("passed")), "feature_results": feature_results, "failing_requirements": failing}

    return {"passed": False, "feature_results": [], "failing_requirements": ["Unrecognized simready-validate output schema"]}


def redact_text(value: str, repo_root: Path) -> str:
    redacted = value.replace(str(repo_root), ".").replace(str(Path.home()), "~")
    for tmp_root in {tempfile.gettempdir(), "/private/tmp", "/tmp"}:
        redacted = redacted.replace(tmp_root, "<tmp>")
    return redacted


def display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root))
    except ValueError:
        return str(path).replace(str(Path.home()), "~")


def tail(value: str, max_chars: int = 4000) -> str:
    return value[-max_chars:]


def render_markdown(report: dict[str, Any]) -> str:
    rows = ["| Feature | Version | Passed |", "| --- | --- | --- |"]
    for feature in report["feature_results"]:
        rows.append(f"| `{feature['feature_id']}` | `{feature.get('version')}` | `{feature['passed']}` |")
    failing = report.get("failing_requirements") or []
    failing_text = "None" if not failing else ", ".join(map(str, failing))
    return (
        f"# NVIDIA SimReady validation — {report['project_id']}\n\n"
        f"Status: **{report['status']}**\n\n"
        f"- Validator: `simready-validate {report['simready_validate_version']}`\n"
        f"- Foundation checkout: `{report['foundation_root']}` @ `{report['foundation_commit']}`\n"
        f"- Profile: `{report['profile_target']['name']}@{report['profile_target']['version']}`\n"
        f"- Asset: `{report['asset_path']}`\n"
        f"- Failing requirements: {failing_text}\n\n"
        "## Feature results\n\n"
        + "\n".join(rows)
        + "\n\nContent Agents material/physics assignment is still a separate NVIDIA endpoint/auth gate.\n"
    )


if __name__ == "__main__":
    raise SystemExit(main())
