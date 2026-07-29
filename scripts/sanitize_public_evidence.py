#!/usr/bin/env python3
"""Remove machine-specific paths and private network addresses from public evidence.

Generated validation reports are useful portfolio evidence, but they should not
publish workstation usernames, home directories, or private-network topology.
Run without flags to rewrite supported text artifacts, or use ``--check`` in CI
to fail when an unsanitized artifact is found.
"""

from __future__ import annotations

import argparse
import ipaddress
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = (
    ROOT / "docs",
    ROOT / "src" / "samples",
)
TEXT_SUFFIXES = {".json", ".md", ".txt", ".usda"}
HOME_PATH = re.compile(r"/(?:Users|home)/[^/\s\"'`)\]}]+")
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")


def _is_private_host(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if address.is_loopback or address.is_unspecified:
        return False
    return address.is_private or address in ipaddress.ip_network("100.64.0.0/10")


def sanitize_text(text: str) -> str:
    sanitized = HOME_PATH.sub("${HOME}", text)
    return IPV4.sub(
        lambda match: "<private-host>" if _is_private_host(match.group(0)) else match.group(0),
        sanitized,
    )


def iter_artifacts() -> list[Path]:
    return sorted(
        path
        for root in SCAN_ROOTS
        if root.exists()
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="report unsanitized files without modifying them",
    )
    args = parser.parse_args()

    changed: list[Path] = []
    for path in iter_artifacts():
        original = path.read_text(encoding="utf-8", errors="replace")
        sanitized = sanitize_text(original)
        if sanitized == original:
            continue
        changed.append(path.relative_to(ROOT))
        if not args.check:
            path.write_text(sanitized, encoding="utf-8")

    if args.check and changed:
        print("Unsanitized public evidence:")
        for path in changed:
            print(f"- {path}")
        return 1

    action = "Sanitized" if not args.check else "Checked"
    print(f"{action} {len(iter_artifacts())} public evidence files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
