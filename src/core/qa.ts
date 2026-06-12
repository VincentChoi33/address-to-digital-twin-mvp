import { escapeHtml } from "../lib/html";
import type { SourceManifest, TwinProject } from "../types/twin";

function confidenceText(value: string): string {
  if (value === "high") return "높음";
  if (value === "medium") return "중간";
  return "낮음";
}

export function generateQaReport(twin: TwinProject, manifest: SourceManifest): string {
  const rows = manifest.layers
    .map(
      (layer) => `
        <tr>
          <td>${escapeHtml(layer.name)}</td>
          <td>${escapeHtml(layer.source)}</td>
          <td><span class="badge ${layer.confidence ?? "low"}">${confidenceText(layer.confidence ?? "low")}</span></td>
        </tr>
      `
    )
    .join("");

  const limitations = manifest.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const nextActions = manifest.next_actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const officialItems = [
    twin.buildings.some((building) => building.role === "target" && building.source_type === "official")
      ? "대상 건물 footprint"
      : "",
    twin.buildings.some((building) => building.role === "surrounding" && building.source_type === "official")
      ? "주변 건물 footprint"
      : "",
    twin.parcel.source_type === "official" ? "필지 경계" : "",
    twin.roads.some((road) => road.source_type === "official") ? "도로 geometry" : ""
  ].filter(Boolean);
  const officialText =
    officialItems.length > 0
      ? `${officialItems.join(", ")}. 단, 이 MVP의 표시는 검토용이며 법적/측량급 효력은 없습니다.`
      : "없음. 현재 산출물은 공식 geometry 없이 프리뷰용으로 생성되었습니다.";
  const approximateItems = [
    twin.buildings.some((building) => building.source_type !== "official") ? "일부 건물 매스/높이" : "",
    twin.parcel.source_type !== "official" ? "필지 경계" : "",
    twin.roads.some((road) => road.source_type !== "official") ? "일부 도로 힌트" : "",
    "강우-침수 해석은 시연용 가속 shallow-water 모델"
  ].filter(Boolean);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(twin.project_id)} QA / Confidence Report</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f3ed; color: #1d1b16; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 56px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin-top: 28px; font-size: 18px; }
    p, li { line-height: 1.65; }
    .notice { background: #fff4cf; border: 1px solid #e5c96a; padding: 14px 16px; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .metric { background: #ffffff; border: 1px solid #ded8cb; border-radius: 8px; padding: 14px; }
    .metric b { display: block; margin-bottom: 6px; color: #5b3b00; }
    table { width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #ded8cb; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 14px; border-bottom: 1px solid #eee6d8; text-align: left; vertical-align: top; }
    th { background: #eee7d9; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; }
    .high { background: #d4f7df; color: #166534; }
    .medium { background: #def0ff; color: #075985; }
    .low { background: #ffe8ca; color: #9a3412; }
    code { background: #eee7d9; padding: 2px 5px; border-radius: 4px; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>QA / Confidence Report</h1>
    <p class="notice">이 산출물은 제안·검토용 프리뷰입니다. 측량급 또는 법적 효력이 있는 디지털 트윈이 아닙니다.</p>

    <section class="grid">
      <div class="metric"><b>프로젝트</b>${escapeHtml(twin.project_id)}</div>
      <div class="metric"><b>입력 주소</b>${escapeHtml(twin.input.raw_query)}</div>
      <div class="metric"><b>좌표 신뢰도</b>${confidenceText(twin.geocoding.confidence)}</div>
    </section>

    <h2>생성된 것</h2>
    <p>브라우저에서 볼 수 있는 3D 프리뷰, 대상 건물 매스, 주변 건물 맥락, 필지/도로 레이어, 침수 시뮬레이션 입력을 생성했습니다.</p>

    <h2>근사값인 것</h2>
    <p>${escapeHtml(approximateItems.join(", "))}</p>

    <h2>공식 데이터인 것</h2>
    <p>${escapeHtml(officialText)}</p>

    <h2>검증이 필요한 것</h2>
    <ul>${limitations}</ul>

    <h2>레이어별 신뢰도</h2>
    <table>
      <thead><tr><th>레이어</th><th>출처</th><th>신뢰도</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2>다음 권장 업그레이드</h2>
    <ol>${nextActions}</ol>

    <h2>좌표 요약</h2>
    <p>선택 좌표: <code>${twin.center.lat.toFixed(5)}, ${twin.center.lon.toFixed(5)}</code> / 공급자: <code>${escapeHtml(twin.geocoding.provider)}</code></p>
  </main>
</body>
</html>`;
}
