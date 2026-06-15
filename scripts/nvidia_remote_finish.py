#!/usr/bin/env python3
"""Run the NVIDIA-only finish chain on a remote GPU host via SSH.

This wrapper exists for the final external gate: the local Mac cannot run NVIDIA
RTX/Content Agents containers, but a GPU host such as `train1` can. The wrapper
never prints secret values. It updates or clones the repo on the remote host,
checks only the presence of credentials/endpoints, runs `npm run nvidia:finish`,
and copies the resulting finish report back to local evidence paths.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import shlex
import subprocess
import time
from typing import Any

DEFAULT_HOST = "train1"
DEFAULT_REMOTE_DIR = "~/workspace/personal/address-to-digital-twin-mvp"
DEFAULT_OUTPUT_JSON = "docs/evidence/nvidia-remote-finish-train1-2026-06-13.json"
DEFAULT_OUTPUT_MD = "docs/evidence/nvidia-remote-finish-train1-2026-06-13.md"
REMOTE_FINISH_JSON = "docs/evidence/nvidia-finish-sadang-2026-06-13.json"
REMOTE_FINISH_MD = "docs/evidence/nvidia-finish-sadang-2026-06-13.md"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run npm run nvidia:finish on a remote NVIDIA GPU host.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="SSH host alias for the NVIDIA GPU host.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help="Remote repo checkout path.")
    parser.add_argument("--branch", default="main", help="Branch to checkout/pull on the remote host.")
    parser.add_argument("--repo-url", default=None, help="Git URL to clone when --remote-dir does not exist; defaults to local origin URL.")
    parser.add_argument("--remote-nvidia-api-key-file", default=None, help="Path to NVIDIA_API_KEY_FILE on the remote host; only the path is sent.")
    parser.add_argument("--remote-material-url", default=None, help="Existing remote Material Agent base URL to export before running finish.")
    parser.add_argument("--remote-physics-url", default=None, help="Existing remote Physics Agent base URL to export before running finish.")
    parser.add_argument("--remote-ovrtx-url", default=None, help="Existing remote OVRTX/render base URL to export before running finish.")
    parser.add_argument("--wait-seconds", type=int, default=900)
    parser.add_argument("--connect-timeout", type=int, default=10)
    parser.add_argument("--allow-blocked", action="store_true", help="Return 0 when the remote finish report is blocked.")
    parser.add_argument("--dry-run", action="store_true", help="Only verify SSH/repo/key/endpoint presence; do not run nvidia:finish.")
    parser.add_argument("--output-json", default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-md", default=DEFAULT_OUTPUT_MD)
    args = parser.parse_args()

    repo_root = Path.cwd()
    repo_url = args.repo_url or local_origin_url(repo_root)
    context = RemoteContext(args=args, repo_root=repo_root, repo_url=repo_url)
    report = run_remote_finish(context)
    write_reports(report, Path(args.output_json), Path(args.output_md))
    print(json.dumps({"status": report["status"], "output_json": args.output_json, "output_md": args.output_md, "blockers": report["blockers"]}, indent=2))
    return 0 if report["status"] == "passed" or (args.allow_blocked and report["status"] == "blocked") else 2


class RemoteContext:
    def __init__(self, args: argparse.Namespace, repo_root: Path, repo_url: str) -> None:
        self.args = args
        self.repo_root = repo_root
        self.repo_url = repo_url

    def ssh(self, script: str, timeout: int = 1800) -> subprocess.CompletedProcess[str]:
        command = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.args.connect_timeout}",
            self.args.host,
            "bash",
            "-s",
        ]
        return subprocess.run(command, input=script, text=True, capture_output=True, timeout=timeout)

    def scp_from(self, remote_path: str, local_path: Path, timeout: int = 300) -> subprocess.CompletedProcess[str]:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            "scp",
            "-q",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.args.connect_timeout}",
            f"{self.args.host}:{remote_path}",
            str(local_path),
        ]
        last: subprocess.CompletedProcess[str] | None = None
        for attempt in range(3):
            last = subprocess.run(command, text=True, capture_output=True, timeout=timeout)
            if last.returncode == 0:
                return last
            if attempt < 2:
                time.sleep(1 + attempt)
        return last


def run_remote_finish(context: RemoteContext) -> dict[str, Any]:
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    steps: list[dict[str, Any]] = []
    blockers: list[str] = []

    remote_script = build_remote_script(context)
    remote = context.ssh(remote_script, timeout=max(9000, context.args.wait_seconds + 7800))
    steps.append({
        "name": "remote-nvidia-finish",
        "status": "passed" if remote.returncode == 0 else "failed",
        "exit_code": remote.returncode,
        "command": ["ssh", context.args.host, "<redacted remote finish script>"],
        "stdout_tail": tail(remote.stdout),
        "stderr_tail": tail(remote.stderr),
    })

    remote_payload = parse_remote_payload(remote.stdout)
    blockers.extend(remote_preflight_blockers(remote_payload.get("preflight") or {}, dry_run=context.args.dry_run))
    finish_status = remote_payload.get("finish_status")
    copied: dict[str, str] = {}
    if remote_payload.get("finish_json"):
        local_finish_json = context.repo_root / REMOTE_FINISH_JSON
        scp_json = context.scp_from(str(remote_payload["finish_json"]), local_finish_json)
        steps.append(step_from_completed("copy-finish-json", scp_json, ["scp", context.args.host + ":<remote finish json>", REMOTE_FINISH_JSON]))
        if scp_json.returncode == 0:
            copied["finish_json"] = REMOTE_FINISH_JSON
            finish_doc = load_json(local_finish_json)
            finish_status = finish_doc.get("status", finish_status)
            blockers.extend(finish_doc.get("blockers") or [])
    if remote_payload.get("finish_md"):
        local_finish_md = context.repo_root / REMOTE_FINISH_MD
        scp_md = context.scp_from(str(remote_payload["finish_md"]), local_finish_md)
        steps.append(step_from_completed("copy-finish-md", scp_md, ["scp", context.args.host + ":<remote finish md>", REMOTE_FINISH_MD]))
        if scp_md.returncode == 0:
            copied["finish_md"] = REMOTE_FINISH_MD

    blockers.extend(remote_payload.get("blockers") or [])
    if remote.returncode != 0 and not blockers:
        blockers.append("Remote NVIDIA finish command failed before producing a parseable finish report.")
    if context.args.dry_run:
        status = "passed" if remote.returncode == 0 and not blockers else "blocked"
    else:
        status = "passed" if finish_status == "passed" and remote.returncode == 0 and not blockers else "blocked"

    return {
        "generated_at": generated_at,
        "status": status,
        "passed": status == "passed",
        "host": context.args.host,
        "remote_dir": context.args.remote_dir,
        "branch": context.args.branch,
        "dry_run": bool(context.args.dry_run),
        "secret_handling": "Remote script reports only credential presence/absence and never prints NVIDIA_API_KEY values.",
        "copied_evidence": copied,
        "remote_payload": remote_payload,
        "steps": steps,
        "blockers": dedupe(blockers),
        "next_commands": [
            f"npm run nvidia:finish:remote -- --host {context.args.host} --remote-nvidia-api-key-file /secure/path/nvidia_api_key",
            f"npm run nvidia:finish:remote -- --host {context.args.host} --allow-blocked",
        ],
    }


def build_remote_script(context: RemoteContext) -> str:
    remote_dir = context.args.remote_dir
    repo_url = context.repo_url
    branch = context.args.branch
    wait_seconds = str(context.args.wait_seconds)
    dry_run = "1" if context.args.dry_run else "0"
    allow_blocked = "1" if context.args.allow_blocked else "0"
    remote_nvidia_api_key_file = context.args.remote_nvidia_api_key_file or ""
    remote_material_url = context.args.remote_material_url or ""
    remote_physics_url = context.args.remote_physics_url or ""
    remote_ovrtx_url = context.args.remote_ovrtx_url or ""
    return f"""
set -euo pipefail
REMOTE_DIR={shlex.quote(remote_dir)}
REPO_URL={shlex.quote(repo_url)}
BRANCH={shlex.quote(branch)}
WAIT_SECONDS={shlex.quote(wait_seconds)}
DRY_RUN={shlex.quote(dry_run)}
ALLOW_BLOCKED={shlex.quote(allow_blocked)}
REMOTE_NVIDIA_API_KEY_FILE={shlex.quote(remote_nvidia_api_key_file)}
REMOTE_MATERIAL_URL={shlex.quote(remote_material_url)}
REMOTE_PHYSICS_URL={shlex.quote(remote_physics_url)}
REMOTE_OVRTX_URL={shlex.quote(remote_ovrtx_url)}
if [ -n "$REMOTE_NVIDIA_API_KEY_FILE" ]; then export NVIDIA_API_KEY_FILE="$REMOTE_NVIDIA_API_KEY_FILE"; fi
if [ -n "$REMOTE_MATERIAL_URL" ]; then export CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL="$REMOTE_MATERIAL_URL"; fi
if [ -n "$REMOTE_PHYSICS_URL" ]; then export CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL="$REMOTE_PHYSICS_URL"; fi
if [ -n "$REMOTE_OVRTX_URL" ]; then export CONTENT_AGENTS_OVRTX_BASE_URL="$REMOTE_OVRTX_URL"; fi
REMOTE_DIR_EXPANDED=$(eval printf '%s' "$REMOTE_DIR")
mkdir -p "$(dirname "$REMOTE_DIR_EXPANDED")"
if [ ! -d "$REMOTE_DIR_EXPANDED/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REMOTE_DIR_EXPANDED"
fi
cd "$REMOTE_DIR_EXPANDED"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
python3 - <<'PY'
import json, os, shutil, socket, subprocess, urllib.request
urls = [
    'http://127.0.0.1:8100/health',
    'http://127.0.0.1:8200/health',
    'http://127.0.0.1:8101/health',
    'http://127.0.0.1:8201/health',
]
def health(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return r.status
    except Exception:
        return 0
summary = {{
    'host': socket.gethostname(),
    'nvidia_smi': shutil.which('nvidia-smi') is not None,
    'gpu_count': None,
    'docker_ready': subprocess.run(['docker','info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0 if shutil.which('docker') else False,
    'env': {{k: ('present' if os.environ.get(k) else 'absent') for k in [
        'NVIDIA_API_KEY','NVIDIA_API_KEY_FILE','CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL','MATERIAL_AGENT_BASE_URL','CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL','PHYSICS_AGENT_BASE_URL'
    ]}},
    'health': {{url: health(url) for url in urls}},
}}
if summary['nvidia_smi']:
    out = subprocess.run(['nvidia-smi','--query-gpu=name','--format=csv,noheader'], text=True, capture_output=True)
    summary['gpu_count'] = len([line for line in out.stdout.splitlines() if line.strip()]) if out.returncode == 0 else None
print('REMOTE_PREFLIGHT_JSON=' + json.dumps(summary, sort_keys=True))
PY
if [ "$DRY_RUN" = "1" ]; then
  python3 - <<'PY'
import json
payload = {{'finish_status': 'dry_run', 'finish_json': None, 'finish_md': None, 'blockers': []}}
print('REMOTE_FINISH_RESULT_JSON=' + json.dumps(payload, sort_keys=True))
PY
  exit 0
fi
set +e
if [ "$ALLOW_BLOCKED" = "1" ]; then
  npm run nvidia:finish -- --allow-blocked --wait-seconds "$WAIT_SECONDS"
else
  npm run nvidia:finish -- --wait-seconds "$WAIT_SECONDS"
fi
rc=$?
set -e
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('docs/evidence/nvidia-finish-sadang-2026-06-13.json')
status = 'missing'
blockers = []
if p.exists():
    try:
        doc = json.loads(p.read_text())
        status = doc.get('status', status)
        blockers = doc.get('blockers') or []
    except Exception as exc:
        blockers = [f'failed to parse finish report: {{exc}}']
payload = {{
    'finish_status': status,
    'finish_json': str(p.resolve()) if p.exists() else None,
    'finish_md': str(pathlib.Path('docs/evidence/nvidia-finish-sadang-2026-06-13.md').resolve()) if pathlib.Path('docs/evidence/nvidia-finish-sadang-2026-06-13.md').exists() else None,
    'blockers': blockers,
}}
print('REMOTE_FINISH_RESULT_JSON=' + json.dumps(payload, sort_keys=True))
PY
exit "$rc"
"""


def local_origin_url(repo_root: Path) -> str:
    completed = subprocess.run(["git", "remote", "get-url", "origin"], cwd=repo_root, text=True, capture_output=True)
    if completed.returncode != 0 or not completed.stdout.strip():
        raise SystemExit("Cannot determine repo URL from git remote origin; pass --repo-url.")
    return completed.stdout.strip()


def parse_remote_payload(stdout: str) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for line in stdout.splitlines():
        if line.startswith("REMOTE_PREFLIGHT_JSON="):
            payload["preflight"] = parse_json_line(line.split("=", 1)[1])
        if line.startswith("REMOTE_FINISH_RESULT_JSON="):
            finish = parse_json_line(line.split("=", 1)[1])
            if isinstance(finish, dict):
                payload.update(finish)
    return payload


def parse_json_line(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


def remote_preflight_blockers(preflight: dict[str, Any], dry_run: bool) -> list[str]:
    blockers: list[str] = []
    if not preflight:
        return ["Remote preflight summary was not produced."]
    if not preflight.get("nvidia_smi") or not preflight.get("gpu_count"):
        blockers.append("Remote NVIDIA GPU/driver is not visible via nvidia-smi.")
    if not preflight.get("docker_ready"):
        blockers.append("Remote Docker daemon is not ready.")
    env = preflight.get("env") or {}
    health = preflight.get("health") or {}
    material_env = env.get("CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL") == "present" or env.get("MATERIAL_AGENT_BASE_URL") == "present"
    physics_env = env.get("CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL") == "present" or env.get("PHYSICS_AGENT_BASE_URL") == "present"
    material_health = health.get("http://127.0.0.1:8100/health") == 200
    physics_health = health.get("http://127.0.0.1:8200/health") == 200
    deploy_auth = env.get("NVIDIA_API_KEY") == "present" or env.get("NVIDIA_API_KEY_FILE") == "present"
    if dry_run and not ((material_env and physics_env) or (material_health and physics_health) or deploy_auth):
        blockers.append("Remote dry-run found no healthy Material/Physics endpoints and no NVIDIA_API_KEY/NVIDIA_API_KEY_FILE for deployment.")
    return blockers


def step_from_completed(name: str, completed: subprocess.CompletedProcess[str], command: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "status": "passed" if completed.returncode == 0 else "failed",
        "exit_code": completed.returncode,
        "command": command,
        "stdout_tail": tail(completed.stdout),
        "stderr_tail": tail(completed.stderr),
    }


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except FileNotFoundError:
        return {}


def tail(value: str, max_chars: int = 4000) -> str:
    return value[-max_chars:]


def dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def write_reports(report: dict[str, Any], json_path: Path, md_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# NVIDIA remote finish report",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Host: `{report['host']}`",
        f"- Remote dir: `{report['remote_dir']}`",
        f"- Branch: `{report['branch']}`",
        f"- Dry run: `{report['dry_run']}`",
        f"- Secret handling: {report['secret_handling']}",
        "",
    ]
    preflight = report.get("remote_payload", {}).get("preflight")
    if preflight:
        lines.extend([
            "## Remote preflight",
            "",
            f"- Hostname: `{preflight.get('host')}`",
            f"- NVIDIA GPU count: `{preflight.get('gpu_count')}`",
            f"- Docker ready: `{preflight.get('docker_ready')}`",
            "",
            "### Credential/endpoint presence",
            "",
            "| Variable | State |",
            "| --- | --- |",
        ])
        for key, value in sorted((preflight.get("env") or {}).items()):
            lines.append(f"| `{key}` | `{value}` |")
        lines.extend(["", "### Health probes", "", "| URL | HTTP status |", "| --- | --- |"])
        for url, value in sorted((preflight.get("health") or {}).items()):
            lines.append(f"| `{url}` | `{value}` |")
        lines.append("")
    lines.extend(["## Steps", "", "| Step | Status | Exit |", "| --- | --- | --- |"])
    for step in report["steps"]:
        lines.append(f"| `{step['name']}` | `{step['status']}` | `{step.get('exit_code', '')}` |")
    if report.get("copied_evidence"):
        lines.extend(["", "## Copied evidence", ""])
        for key, value in report["copied_evidence"].items():
            lines.append(f"- `{key}`: `{value}`")
    if report["blockers"]:
        lines.extend(["", "## Blockers", ""])
        lines.extend(f"- {blocker}" for blocker in report["blockers"])
    lines.extend(["", "## Next commands", ""])
    lines.extend(f"- `{command}`" for command in report["next_commands"])
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
