#!/usr/bin/env python3
"""Batch QA runner for address-to-digital-twin preview candidates.

Reads Korean address lines from stdin or a text file, runs the same Juso/VWorld/WFS
pipeline used by the deploy server, persists each generated preview, and writes a
small public HTML report under dist/generated.
"""

from __future__ import annotations

import argparse
import html
import json
import time
from pathlib import Path
from typing import Any

import server


def pnu_of(obj: dict[str, Any] | None) -> str:
    return str(((obj or {}).get("source_ref") or {}).get("pnu") or "")


def status_for(row: dict[str, Any]) -> tuple[str, str]:
    if row["target_source"] != "official":
        return "needs-geometry", "건물 footprint 없음"
    if row["target_pnu"] and row["parcel_pnu"] and row["target_pnu"] != row["parcel_pnu"]:
        return "pnu-mismatch", "건물/필지 PNU 불일치"
    if row["geocode_confidence"] != "high":
        return "check-address", "주소 정규화 확인"
    return "good", "프리뷰 적합"


def run_one(query: str) -> dict[str, Any]:
    geocoding = server.geocode_address(query)
    twin = server.build_twin(query, geocoding)
    manifest = server.build_manifest(twin)
    links = server.persist_project(twin, manifest)
    target = next((building for building in twin["buildings"] if building.get("role") == "target"), {})
    parcel = twin.get("parcel") or {}
    target_pnu = pnu_of(target)
    parcel_pnu = pnu_of(parcel)
    row = {
        "query": query,
        "project_id": twin["project_id"],
        "geocode_provider": geocoding["provider"],
        "geocode_confidence": geocoding["confidence"],
        "road_address": twin["addresses"]["road_address_candidate"],
        "parcel_address": twin["addresses"]["parcel_address"],
        "building_candidate": twin["addresses"]["building_name_candidate"],
        "selected_target": target.get("name") or "",
        "target_source": target.get("source_type") or "",
        "target_confidence": target.get("confidence") or "",
        "height_m": target.get("height_m"),
        "target_pnu": target_pnu,
        "parcel_source": parcel.get("source_type") or "",
        "parcel_confidence": parcel.get("confidence") or "",
        "parcel_pnu": parcel_pnu,
        "pnu_match": bool(target_pnu and parcel_pnu and target_pnu == parcel_pnu),
        "official_context_buildings": sum(
            1
            for building in twin["buildings"]
            if building.get("role") == "surrounding" and building.get("source_type") == "official"
        ),
        "official_roads": sum(1 for road in twin["roads"] if road.get("source_type") == "official"),
        "preview": links["preview"],
        "manifest": links["manifest"],
        "qa": links["qa"],
        "data": links["data"],
    }
    status, status_label = status_for(row)
    row["status"] = status
    row["status_label"] = status_label
    return row


def report_html(rows: list[dict[str, Any]], generated_at: str) -> str:
    def esc(value: Any) -> str:
        return html.escape("" if value is None else str(value))

    body = "\n".join(
        f"""
        <tr class="{esc(row['status'])}">
          <td>{index}</td>
          <td><strong>{esc(row['query'])}</strong><br><span>{esc(row['road_address'])}</span><br><span>{esc(row['parcel_address'])}</span></td>
          <td><b>{esc(row['status_label'])}</b><br><span>{esc(row['geocode_provider'])}/{esc(row['geocode_confidence'])}</span></td>
          <td>{esc(row['selected_target'])}<br><span>{esc(row['target_source'])}/{esc(row['target_confidence'])}</span><br><span>{esc(row['height_m'])}m</span></td>
          <td><code>{esc(row['target_pnu']) or '-'}</code><br><code>{esc(row['parcel_pnu']) or '-'}</code></td>
          <td>{esc(row['official_context_buildings'])} buildings<br>{esc(row['official_roads'])} roads</td>
          <td><a href="{esc(row['preview'])}">preview</a><br><a href="{esc(row['manifest'])}">manifest</a><br><a href="{esc(row['qa'])}">QA</a></td>
        </tr>
        """
        for index, row in enumerate(rows, 1)
    )
    totals = {
        "good": sum(1 for row in rows if row["status"] == "good"),
        "needs": sum(1 for row in rows if row["status"] != "good"),
        "official_target": sum(1 for row in rows if row["target_source"] == "official"),
    }
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Address Batch QA</title>
  <style>
    body {{ margin:0; background:#f4f1ea; color:#1f1d18; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
    main {{ max-width:1280px; margin:0 auto; padding:32px 20px 56px; }}
    h1 {{ margin:0 0 8px; font-size:28px; }}
    p {{ color:#5a5348; line-height:1.55; }}
    .summary {{ display:flex; gap:10px; flex-wrap:wrap; margin:18px 0; }}
    .pill {{ border-radius:999px; padding:8px 12px; background:#fff; border:1px solid #ded8ca; font-weight:800; }}
    table {{ width:100%; border-collapse:collapse; background:#fff; border:1px solid #ddd5c8; }}
    th,td {{ padding:10px; border-bottom:1px solid #e7dfd2; text-align:left; vertical-align:top; font-size:13px; }}
    th {{ background:#26231d; color:#fff7de; position:sticky; top:0; }}
    span {{ color:#6b6254; }}
    code {{ font-size:11px; color:#334155; }}
    a {{ color:#00796b; font-weight:800; }}
    tr.good td:first-child {{ border-left:6px solid #28b779; }}
    tr.needs-geometry td:first-child {{ border-left:6px solid #ef9b2d; }}
    tr.pnu-mismatch td:first-child, tr.check-address td:first-child {{ border-left:6px solid #d94848; }}
    .notice {{ background:#fff5d6; border:1px solid #e3c667; padding:12px 14px; border-radius:8px; }}
  </style>
</head>
<body>
<main>
  <h1>주소 배치 QA 리포트</h1>
  <p class="notice">이 리포트는 preview/검토용입니다. 측량급 또는 법적 효력이 있는 디지털 트윈 판정이 아닙니다.</p>
  <p>Generated at {esc(generated_at)}. Juso/VWorld/WFS 연결 결과와 자동 target/parcel 선택 상태를 빠르게 확인합니다.</p>
  <div class="summary">
    <div class="pill">총 {len(rows)}개</div>
    <div class="pill">프리뷰 적합 {totals['good']}개</div>
    <div class="pill">확인 필요 {totals['needs']}개</div>
    <div class="pill">official target footprint {totals['official_target']}개</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>주소</th><th>상태</th><th>선택 대상 건물</th><th>PNU<br>target / parcel</th><th>주변 official</th><th>산출물</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
</main>
</body>
</html>
"""


def read_addresses(path: str | None) -> list[str]:
    if path:
        text = Path(path).read_text(encoding="utf-8")
    else:
        import sys

        text = sys.stdin.read()
    return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("address_file", nargs="?")
    parser.add_argument("--project-id", default="")
    args = parser.parse_args()

    addresses = read_addresses(args.address_file)
    if not addresses:
        raise SystemExit("No addresses provided.")

    generated_at = server.now_iso()
    project_id = args.project_id or f"address_batch_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}"
    rows = [run_one(address) for address in addresses]
    output_dir = server.GENERATED / project_id
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "index.html").write_text(report_html(rows, generated_at), encoding="utf-8")
    print(json.dumps({"project_id": project_id, "report": f"/generated/{project_id}/index.html", "results": f"/generated/{project_id}/results.json", "rows": rows}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
