#!/usr/bin/env python3
"""Produce a single NVIDIA-only acceptance report for the Sadang twin.

This script does not try to "greenwash" the project.  It aggregates the
authoritative package files and committed GPU-host evidence and returns
`blocked` until every NVIDIA-only runtime gate is proven, including real
Omniverse Content Agents material/physics assignment.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

DEFAULT_PROJECT_ID = "sadang_317_6"
DEFAULT_PACKAGE_DIR = f"src/samples/{DEFAULT_PROJECT_ID}/omniverse"
DEFAULT_OUTPUT_JSON = "docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.json"
DEFAULT_OUTPUT_MD = "docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.md"


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggregate NVIDIA-only acceptance evidence.")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--package-dir", default=DEFAULT_PACKAGE_DIR)
    parser.add_argument("--output-json", default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", default=DEFAULT_OUTPUT_MD)
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 when the report is blocked but not failed.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    package_dir = (repo_root / args.package_dir).resolve()
    report = build_report(args.project_id, package_dir, repo_root)
    write_reports(report, Path(args.output_json), Path(args.output_md))
    print(json.dumps({"status": report["status"], "output_json": args.output_json, "output_md": args.output_md, "blockers": report["blockers"]}, indent=2))
    return 0 if report["status"] == "passed" or (args.allow_blocked and report["status"] == "blocked") else 2


def build_report(project_id: str, package_dir: Path, repo_root: Path) -> dict[str, Any]:
    evidence = Evidence(repo_root, package_dir, project_id)
    gates = [
        gate_openusd_package(evidence),
        gate_viewer_contract(evidence),
        gate_ovrtx_first_frame(evidence),
        gate_ovstream_server(evidence),
        gate_ovstream_browser(evidence),
        gate_warp_flood(evidence),
        gate_simready_validator(evidence),
        gate_content_agents_deploy(evidence),
        gate_content_agents_run(evidence),
    ]
    status = aggregate_status(gates)
    blockers = [gate["evidence"] for gate in gates if gate["status"] == "blocked"]
    failures = [gate["evidence"] for gate in gates if gate["status"] == "failed"]
    return {
        "project_id": project_id,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": status,
        "passed": status == "passed",
        "package_dir": display_path(package_dir, repo_root),
        "gates": gates,
        "blockers": blockers,
        "failures": failures,
        "next_commands": [
            "NVIDIA_API_KEY_FILE=/secure/path/nvidia_api_key npm run nvidia:content-agents:deploy -- up",
            "npm run nvidia:content-agents:deploy:status -- --wait-seconds 900",
            "source .tmp/nvidia-content-agents/endpoints.env",
            "npm run nvidia:content-agents",
            "npm run nvidia:simready",
            "npm run nvidia:acceptance",
        ],
    }


class Evidence:
    def __init__(self, repo_root: Path, package_dir: Path, project_id: str) -> None:
        self.repo_root = repo_root
        self.package_dir = package_dir
        self.project_id = project_id

    def package_json(self, name: str) -> dict[str, Any]:
        return load_json(self.package_dir / name)

    def evidence_json(self, name: str) -> dict[str, Any]:
        return load_json(self.repo_root / "docs/evidence" / name)

    def first_json(self, names: list[str]) -> tuple[dict[str, Any], str]:
        for name in names:
            path = self.repo_root / name
            data = load_json(path)
            if data:
                return data, name
        return {}, names[-1] if names else ""

    def exists(self, path: str) -> bool:
        return (self.repo_root / path).is_file()

    def package_exists(self, path: str) -> bool:
        return (self.package_dir / path).is_file()

    def package_text(self, path: str) -> str:
        try:
            return (self.package_dir / path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""


def gate_openusd_package(e: Evidence) -> dict[str, Any]:
    handoff = e.package_json("handoff_manifest.json")
    train_validation = e.evidence_json("nvidia-train1-package-validation-2026-06-12.json")
    stage_text = e.package_text(f"{e.project_id}.usda")
    required_markers = ["metersPerUnit = 1", "MaterialBindingAPI", "PhysicsScene", "PhysicsCollisionAPI", "PhysicsMassAPI"]
    markers_ok = all(marker in stage_text for marker in required_markers)
    ok = handoff.get("status") == "ready_for_gpu_host" and train_validation.get("status") == "passed" and markers_ok
    return gate(
        "OPENUSD.PACKAGE.001",
        "OpenUSD package, physics/material semantics, and package validation",
        "passed" if ok else "failed",
        f"handoff={handoff.get('status')}, train1_package_validation={train_validation.get('status')}, markers_ok={markers_ok}",
        [
            "src/samples/sadang_317_6/omniverse/handoff_manifest.json",
            "docs/evidence/nvidia-train1-package-validation-2026-06-12.json",
        ],
    )


def gate_viewer_contract(e: Evidence) -> dict[str, Any]:
    contract = e.package_json("ovstream_viewer_contract.json")
    client = (e.package_dir / "ovstream_browser_client/src/main.ts").read_text(encoding="utf-8") if e.package_exists("ovstream_browser_client/src/main.ts") else ""
    package = e.package_json("ovstream_browser_client/package.json")
    forbidden = contract.get("browser_client_contract", {}).get("forbidden_renderers", [])
    ok = (
        contract.get("transport", {}).get("browser_surface") == "video_stream_only"
        and "WebGL" in forbidden
        and "@nvidia/ov-web-rtc" in json.dumps(package)
        and "StreamType.DIRECT" in client
        and "WebGLRenderer" not in client
        and "three" not in json.dumps(package).lower()
    )
    return gate(
        "VIEWER.NO_WEBGL.001",
        "Browser viewer is NVIDIA ovstream/WebRTC video-only, not client WebGL USD rendering",
        "passed" if ok else "failed",
        f"browser_surface={contract.get('transport', {}).get('browser_surface')}, forbidden_has_webgl={'WebGL' in forbidden}, nvidia_client={'@nvidia/ov-web-rtc' in json.dumps(package)}",
        [
            "src/samples/sadang_317_6/omniverse/ovstream_viewer_contract.json",
            "src/samples/sadang_317_6/omniverse/ovstream_browser_client/package.json",
            "src/samples/sadang_317_6/omniverse/ovstream_browser_client/src/main.ts",
        ],
    )


def gate_ovrtx_first_frame(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-train1-ovrtx-first-frame-2026-06-12.json")
    image = e.exists("docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png")
    ok = data.get("status") == "passed" and image and data.get("reason") == "LdrColor frame produced"
    return gate(
        "OMNIVERSE.OVRTX_FIRST_FRAME.001",
        "NVIDIA ovrtx produced a real RTX LdrColor first frame on train1",
        "passed" if ok else "failed",
        f"status={data.get('status')}, reason={data.get('reason')}, image={image}",
        [
            "docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.json",
            "docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png",
        ],
    )


def gate_ovstream_server(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-train1-ovstream-smoke-2026-06-12.json")
    ok = data.get("status") == "passed" and "ovstream WebRTC server started" in str(data.get("reason", ""))
    return gate(
        "OMNIVERSE.OVSTREAM_SERVER.001",
        "NVIDIA ovrtx frame was converted to CUDA BGRA and served via ovstream/WebRTC",
        "passed" if ok else "failed",
        f"status={data.get('status')}, reason={data.get('reason')}",
        ["docs/evidence/nvidia-train1-ovstream-smoke-2026-06-12.json"],
    )


def gate_ovstream_browser(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-train1-ovstream-browser-first-frame-2026-06-12.json")
    video = data.get("video", {})
    screenshot = e.exists("docs/evidence/nvidia-train1-ovstream-browser-first-frame-2026-06-12.png")
    ok = (
        data.get("status") == "passed"
        and str(video.get("firstVideoFrame")).lower() == "true"
        and int(video.get("videoWidth") or 0) > 0
        and int(video.get("videoHeight") or 0) > 0
        and screenshot
    )
    return gate(
        "OMNIVERSE.OVSTREAM_BROWSER.001",
        "Browser decoded an NVIDIA ov-web-rtc Direct video first frame",
        "passed" if ok else "failed",
        f"status={data.get('status')}, firstVideoFrame={video.get('firstVideoFrame')}, size={video.get('videoWidth')}x{video.get('videoHeight')}, screenshot={screenshot}",
        [
            "docs/evidence/nvidia-train1-ovstream-browser-first-frame-2026-06-12.json",
            "docs/evidence/nvidia-train1-ovstream-browser-first-frame-2026-06-12.png",
        ],
    )


def gate_warp_flood(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-train1-warp-flood-smoke-2026-06-13.json")
    acceptance = data.get("acceptance", {})
    preview = e.exists("docs/evidence/nvidia-train1-warp-flood-depth-2026-06-13.png")
    ok = data.get("status") == "passed" and all(bool(value) for value in acceptance.values()) and preview
    return gate(
        "NVIDIA.WARP_FLOOD.001",
        "NVIDIA Warp/CUDA shallow-water flood smoke passed on train1",
        "passed" if ok else "failed",
        f"status={data.get('status')}, acceptance={acceptance}, preview={preview}",
        [
            "docs/evidence/nvidia-train1-warp-flood-smoke-2026-06-13.json",
            "docs/evidence/nvidia-train1-warp-flood-depth-2026-06-13.png",
        ],
    )


def gate_simready_validator(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-simready-validate-sadang-2026-06-12.json")
    profile = data.get("profile_target")
    if isinstance(profile, dict):
        profile_label = f"{profile.get('name')}@{profile.get('version')}"
    else:
        profile_label = str(profile)
    ok = data.get("status") == "passed" and profile_label == "Prop-Robotics-Neutral@1.0.0"
    return gate(
        "SIMREADY.VALIDATOR.001",
        "NVIDIA SimReady validator passed the self-contained asset-source copy",
        "passed" if ok else "failed",
        f"status={data.get('status')}, profile={profile_label}, validator={data.get('simready_validate_version')}",
        ["docs/evidence/nvidia-simready-validate-sadang-2026-06-12.json"],
    )


def gate_content_agents_deploy(e: Evidence) -> dict[str, Any]:
    data, source = e.first_json(
        [
            ".tmp/nvidia-finish/deploy-up.json",
            ".tmp/nvidia-finish/deploy-status.json",
            ".tmp/nvidia-finish/deploy-plan.json",
            "docs/evidence/nvidia-train1-content-agents-deploy-plan-2026-06-13.json",
        ]
    )
    blockers = data.get("blockers", [])
    gpu = data.get("gpu_assignment", {})
    deploy_prereqs_ready = (
        data.get("content_agents_upstream", {}).get("available") is True
        and data.get("checks", {}).get("docker_gpu_smoke", {}).get("ok") is True
        and gpu.get("policy") == "auto_multi_gpu_split"
    )
    if data.get("status") == "ready":
        status = "passed"
    elif data.get("status") == "ready_to_deploy" or deploy_prereqs_ready:
        status = "blocked" if blockers else "passed"
    else:
        status = "failed"
    return gate(
        "CONTENT_AGENTS.DEPLOY_READY.001",
        "Official NVIDIA Content Agents deployment path is ready and/or already healthy",
        status,
        f"status={data.get('status')}, blockers={blockers}, gpu_assignment={gpu}, endpoint_env={data.get('endpoint_env_path')}, source={source}",
        [source],
    )


def gate_content_agents_run(e: Evidence) -> dict[str, Any]:
    data = e.evidence_json("nvidia-content-agents-run-sadang-2026-06-12.json")
    status = "passed" if data.get("status") == "passed" and data.get("passed") is True else "blocked"
    return gate(
        "CONTENT_AGENTS.RUNTIME.001",
        "NVIDIA Content Agents Material→Physics assignment has actually run",
        status,
        f"status={data.get('status')}, blockers={data.get('blockers', [])}",
        ["docs/evidence/nvidia-content-agents-run-sadang-2026-06-12.json"],
    )


def gate(gate_id: str, requirement: str, status: str, evidence: str, sources: list[str]) -> dict[str, Any]:
    return {
        "id": gate_id,
        "requirement": requirement,
        "status": status,
        "evidence": evidence,
        "sources": sources,
    }


def aggregate_status(gates: list[dict[str, Any]]) -> str:
    statuses = {gate["status"] for gate in gates}
    if "failed" in statuses:
        return "failed"
    if "blocked" in statuses:
        return "blocked"
    return "passed"


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except FileNotFoundError:
        return {}


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
        "# NVIDIA-only acceptance report",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Project: `{report['project_id']}`",
        f"- Package: `{report['package_dir']}`",
        f"- Generated: `{report['generated_at']}`",
        "",
        "## Gates",
        "",
        "| Gate | Status | Requirement | Evidence |",
        "| --- | --- | --- | --- |",
    ]
    for gate_item in report["gates"]:
        lines.append(f"| `{gate_item['id']}` | `{gate_item['status']}` | {gate_item['requirement']} | {gate_item['evidence']} |")
    if report["blockers"]:
        lines.extend(["", "## Blockers", ""])
        lines.extend(f"- {blocker}" for blocker in report["blockers"])
    if report["failures"]:
        lines.extend(["", "## Failures", ""])
        lines.extend(f"- {failure}" for failure in report["failures"])
    lines.extend(["", "## Next commands", ""])
    lines.extend(f"- `{command}`" for command in report["next_commands"])
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
