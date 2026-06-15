#!/usr/bin/env python3
"""Securely install an NVIDIA API key on a remote GPU host.

The key is read via a hidden local prompt (or stdin when explicitly requested),
streamed over SSH to a 0600 file, and never printed. Optionally this can run the
repo's remote NVIDIA finish chain immediately after installation.
"""
from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path
import shlex
import subprocess
import sys
from typing import Any

DEFAULT_HOST = "train1"
DEFAULT_REMOTE_KEY_FILE = "~/.secrets/nvidia_api_key"
DEFAULT_REMOTE_DIR = "~/workspace/personal/address-to-digital-twin-mvp"


def main() -> int:
    parser = argparse.ArgumentParser(description="Install NVIDIA_API_KEY_FILE on a remote GPU host without printing the secret.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--remote-key-file", default=DEFAULT_REMOTE_KEY_FILE)
    parser.add_argument("--connect-timeout", type=int, default=10)
    parser.add_argument("--from-stdin", action="store_true", help="Read the key from stdin instead of a hidden prompt.")
    parser.add_argument("--run-finish", action="store_true", help="Run npm run nvidia:finish:remote after key installation.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help="Remote repo checkout path for --run-finish.")
    parser.add_argument("--wait-seconds", type=int, default=900)
    args = parser.parse_args()

    key = read_key(args.from_stdin)
    if not key:
        print("No NVIDIA API key was provided.", file=sys.stderr)
        return 2
    if "\n" in key or "\r" in key:
        print("NVIDIA API key must be a single line.", file=sys.stderr)
        return 2

    install = install_remote_key(args, key)
    print(json.dumps(install, indent=2))
    if install["status"] != "installed":
        return 2

    if args.run_finish:
        return run_finish(args)
    return 0


def read_key(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.read().strip()
    return getpass.getpass("NVIDIA_API_KEY 붙여넣기(화면에 안 보임): ").strip()


def install_remote_key(args: argparse.Namespace, key: str) -> dict[str, Any]:
    remote_script = r'''
set -euo pipefail
REMOTE_KEY_FILE="$1"
case "$REMOTE_KEY_FILE" in
  \~/*) REMOTE_KEY_FILE="$HOME/${REMOTE_KEY_FILE#~/}" ;;
esac
REMOTE_DIR=$(dirname "$REMOTE_KEY_FILE")
mkdir -p "$REMOTE_DIR"
chmod 700 "$REMOTE_DIR" 2>/dev/null || true
tmp="$REMOTE_KEY_FILE.tmp.$$"
cat > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$REMOTE_KEY_FILE"
mode=$(stat -c %a "$REMOTE_KEY_FILE" 2>/dev/null || stat -f %Lp "$REMOTE_KEY_FILE")
bytes=$(wc -c < "$REMOTE_KEY_FILE" | tr -d ' ')
printf '{"status":"installed","path":"%s","mode":"%s","bytes":%s}\n' "$REMOTE_KEY_FILE" "$mode" "$bytes"
'''
    remote_command = "bash -c " + shlex.quote(remote_script) + " -- " + shlex.quote(args.remote_key_file)
    command = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        f"ConnectTimeout={args.connect_timeout}",
        args.host,
        remote_command,
    ]
    completed = subprocess.run(command, input=key + "\n", text=True, capture_output=True)
    if completed.returncode != 0:
        return {
            "status": "failed",
            "host": args.host,
            "path": args.remote_key_file,
            "stderr_tail": completed.stderr[-2000:],
        }
    try:
        payload = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        payload = {"status": "installed", "path": args.remote_key_file}
    payload["host"] = args.host
    payload["secret_handling"] = "Key value was streamed over SSH stdin and was not printed."
    return payload


def run_finish(args: argparse.Namespace) -> int:
    command = [
        "npm",
        "run",
        "nvidia:finish:remote",
        "--",
        "--host",
        args.host,
        "--remote-nvidia-api-key-file",
        args.remote_key_file,
        "--remote-dir",
        args.remote_dir,
        "--wait-seconds",
        str(args.wait_seconds),
    ]
    completed = subprocess.run(command, text=True)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
