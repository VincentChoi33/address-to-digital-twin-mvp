import { escapeHtml } from "../lib/html";
import { SCENARIOS } from "../sim/hydrology";
import type { SourceManifest, TwinProject } from "../types/twin";

export interface UiControls {
  sceneHost: HTMLElement;
  webglFallback: HTMLElement;
  promptInput: HTMLTextAreaElement;
  runButton: HTMLButtonElement;
  agentTranscript: HTMLElement;
  agentSteps: HTMLElement;
  agentOutputs: HTMLElement;
  sourceStatus: HTMLElement;
  modelStatus: HTMLElement;
  parcelAddress: HTMLElement;
  roadAddress: HTMLElement;
  buildingName: HTMLElement;
  coordinates: HTMLElement;
  confidence: HTMLElement;
  parcelBoundarySource: HTMLElement;
  layerRows: HTMLElement;
  warningBanner: HTMLElement;
  undergroundAlert: HTMLElement;

  orbitButton: HTMLButtonElement;
  topButton: HTMLButtonElement;
  satelliteButton: HTMLButtonElement;
  massButton: HTMLButtonElement;
  xrayButton: HTMLButtonElement;
  shadowButton: HTMLButtonElement;

  statSurface: HTMLElement;
  statPipe: HTMLElement;
  statUnderground: HTMLElement;
  statOutflow: HTMLElement;
  statOverflow: HTMLElement;

  rainSlider: HTMLInputElement;
  rainLabel: HTMLElement;
  scenarioButtons: HTMLButtonElement[];
  dryButton: HTMLButtonElement;

  inspectCoord: HTMLElement;
  inspectType: HTMLElement;
  inspectMeta: HTMLElement;
  inspectElevation: HTMLElement;
  inspectWater: HTMLElement;
  inspectInfra: HTMLElement;
  inspectPipeWater: HTMLElement;

  gaugeDrainValue: HTMLElement;
  gaugeDrainBar: HTMLElement;
  gaugePressureValue: HTMLElement;
  gaugePressureBar: HTMLElement;
  gaugeVelocityValue: HTMLElement;
  gaugeVelocityBar: HTMLElement;

  chartCanvas: HTMLCanvasElement;
  logFeed: HTMLElement;
  basemapAttribution: HTMLElement;
  themeToggle: HTMLButtonElement;
  soundToggle: HTMLButtonElement;
  toolButtons: HTMLButtonElement[];
}

export function confidenceKo(value: string): string {
  if (value === "high") return "높음";
  if (value === "medium") return "중간";
  return "낮음";
}

export function geocodingStatusKo(provider: string): string {
  if (provider === "vworld") return "공간 데이터: VWorld 연결";
  if (provider === "nominatim") return "공간 데이터: Nominatim 참고";
  return "공간 데이터: 공식 GIS 미연결";
}

export function sourceTypeKo(value: string): string {
  if (value === "official") return "공식/WFS";
  if (value === "osm") return "OSM";
  if (value === "procedural") return "추정 fallback";
  return value || "미확인";
}

function spatialAnchorKo(twin: TwinProject): string {
  const source = twin.spatial_reference?.anchor_source;
  if (source === "official_parcel_centroid") return "필지 기준";
  if (source === "official_target_footprint_centroid") return "건물 기준";
  if (source === "target_preview_centroid") return "매스 기준";
  return "검색 좌표";
}

export function coordinateText(twin: TwinProject): string {
  return `${twin.center.lat.toFixed(5)}, ${twin.center.lon.toFixed(5)} (${spatialAnchorKo(twin)})`;
}

export function layerRows(manifest: SourceManifest): string {
  return manifest.layers
    .map(
      (layer) => `
        <div class="layer-row">
          <span>${escapeHtml(layer.name)}<small>${escapeHtml(layer.source)}</small></span>
          <b class="confidence ${layer.confidence ?? "low"}">${confidenceKo(layer.confidence ?? "low")}</b>
        </div>
      `
    )
    .join("");
}

export function rainLabelText(value: number): string {
  if (value > 120) return `🚨 극한 폭우 (${value}mm/h)`;
  if (value > 60) return `🌧️ 집중호우 (${value}mm/h)`;
  if (value > 0) return `🌦️ 약한 강우 (${value}mm/h)`;
  return "맑음 (0mm/h)";
}

const TOOLS: Array<{ id: string; label: string }> = [
  { id: "inspect", label: "🔍 격자 관찰" },
  { id: "road", label: "🛣️ 도로 포장" },
  { id: "building", label: "🏢 건물 건설" },
  { id: "sewer", label: "🕳️ 빗물받이" },
  { id: "pipe", label: "⚙️ 지하 배수관" },
  { id: "outfall", label: "🌊 방류 토구" },
  { id: "raise", label: "🔺 고도 상승" },
  { id: "lower", label: "🔻 고도 하강" },
  { id: "eraser", label: "🧹 지우개" }
];

export function createUi(app: HTMLElement, twin: TwinProject, manifest: SourceManifest): UiControls {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <h1>주소 → 디지털 트윈 · 침수 시뮬레이터</h1>
          <p>주소 한 줄로 3D 트윈을 만들고 그 위에서 도시 침수를 실험합니다</p>
        </div>
        <div class="topbar-stats">
          <div class="stat"><span>지상 우수</span><b id="statSurface" class="accent">0.0 ㎥</b></div>
          <div class="stat"><span>지하 관거</span><b id="statPipe">0.0 ㎥</b></div>
          <div class="stat"><span>지하공간 침수</span><b id="statUnderground">0.0 ㎥</b></div>
          <div class="stat"><span>누적 방류</span><b id="statOutflow">0.0 ㎥</b></div>
          <div class="stat"><span>역류 맨홀</span><b id="statOverflow">0</b></div>
        </div>
        <div class="status-stack">
          <span id="sourceStatus" class="status-pill pending">공간 데이터 확인 중</span>
          <span id="modelStatus" class="status-pill pending">LLM 확인 중</span>
        </div>
      </header>

      <aside class="panel left-panel">
        <section class="panel-section">
          <label class="section-title" for="promptInput">AI 주소 콘솔</label>
          <div class="agent-console">
            <textarea id="promptInput" rows="2" placeholder="예: 서울 강남구 테헤란로 152 디지털 트윈 만들어줘"></textarea>
            <button id="runButton" type="button">트윈 생성</button>
          </div>
          <div id="agentTranscript" class="agent-transcript" aria-live="polite"></div>
          <div id="agentSteps" class="agent-steps"></div>
          <div id="agentOutputs" class="agent-outputs"></div>
        </section>

        <section class="panel-section">
          <div class="section-title">주소 정보</div>
          <div class="meta-grid">
            <span>지번</span><b id="parcelAddress">${escapeHtml(twin.addresses.parcel_address)}</b>
            <span>도로명</span><b id="roadAddress">${escapeHtml(twin.addresses.road_address_candidate)}</b>
            <span>건물명</span><b id="buildingName">${escapeHtml(twin.addresses.building_name_candidate)}</b>
            <span>기준점</span><b id="coordinates">${coordinateText(twin)}</b>
            <span>신뢰도</span><b id="confidence">${confidenceKo(twin.geocoding.confidence)}</b>
            <span>필지 경계</span><b id="parcelBoundarySource">${sourceTypeKo(twin.parcel.source_type)} / ${confidenceKo(twin.parcel.confidence)}</b>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">뷰 컨트롤</div>
          <div class="control-grid">
            <button id="orbitButton" class="active" type="button">궤도 보기</button>
            <button id="topButton" type="button">정사 상단</button>
            <button id="satelliteButton" type="button">위성</button>
            <button id="massButton" class="active" type="button">트윈 매스</button>
            <button id="xrayButton" type="button">X-Ray</button>
            <button id="shadowButton" class="active" type="button">그림자</button>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">기상 강우량 (Rainfall)</div>
          <div class="rain-row">
            <span id="rainLabel">맑음 (0mm/h)</span>
            <input id="rainSlider" type="range" min="0" max="150" value="0" />
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">재난 시나리오</div>
          <div class="scenario-grid">
            ${SCENARIOS.map(
              (scenario, index) =>
                `<button class="scenario-btn${index === 0 ? " active" : ""}" data-scenario="${scenario.id}" title="${escapeHtml(scenario.description)}" type="button">${escapeHtml(scenario.label)}</button>`
            ).join("")}
          </div>
          <button class="reset-btn" id="dryButton" type="button">🧹 지표 건조 (Dry)</button>
        </section>

        <section class="panel-section">
          <div class="section-title">선택 격자 (GIS)</div>
          <div class="info-card">
            <div class="info-title" id="inspectCoord">선택된 격자 없음</div>
            <div class="info-row"><span>유형</span><span id="inspectType">-</span></div>
            <div class="info-row"><span>메타데이터</span><span id="inspectMeta">-</span></div>
            <div class="info-row"><span>표고</span><span id="inspectElevation">-</span></div>
            <div class="info-row"><span>지표수</span><span id="inspectWater" class="accent">-</span></div>
            <div class="info-row"><span>배수 시설</span><span id="inspectInfra">-</span></div>
            <div class="info-row"><span>관내 우수</span><span id="inspectPipeWater">-</span></div>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">수문 계측</div>
          <div class="info-card gauges">
            <div>
              <div class="info-row"><span>배수 효율</span><span id="gaugeDrainValue">0%</span></div>
              <div class="gauge-track"><div class="gauge-bar" id="gaugeDrainBar"></div></div>
            </div>
            <div>
              <div class="info-row"><span>관거 수압 부하</span><span id="gaugePressureValue">0%</span></div>
              <div class="gauge-track"><div class="gauge-bar" id="gaugePressureBar"></div></div>
            </div>
            <div>
              <div class="info-row"><span>방류 유속</span><span id="gaugeVelocityValue">0.0 m/s</span></div>
              <div class="gauge-track"><div class="gauge-bar" id="gaugeVelocityBar"></div></div>
            </div>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">실시간 하이드로그래프</div>
          <div class="chart-box"><canvas id="chartCanvas"></canvas></div>
        </section>

        <section class="panel-section">
          <div class="section-title">모니터 로그</div>
          <div class="log-feed" id="logFeed">
            <div class="log-item info">시뮬레이터 준비 완료.</div>
          </div>
        </section>
      </aside>

      <main class="stage">
        <div id="sceneHost" class="scene-host"></div>
        <div id="webglFallback" class="webgl-fallback" hidden>
          <b>3D 미리보기를 사용할 수 없습니다</b>
          <p>이 브라우저/환경에서 WebGL 컨텍스트를 만들 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저에서 열어 주세요.
          주소 분석과 산출물(트윈 JSON·QA 리포트) 생성은 계속 사용할 수 있습니다.</p>
        </div>
        <div id="undergroundAlert" class="stage-alert" hidden>🚨 지하공간(지하철/지하상가) 우수 유입 감지! 🚨</div>
        <div class="legend">
          <div><span class="chip target"></span>대상 건물</div>
          <div><span class="chip context"></span>주변 매스</div>
          <div><span class="chip road"></span>도로</div>
          <div><span class="chip water"></span>지표수</div>
          <div><span class="chip overflow"></span>역류 맨홀</div>
        </div>
        <div id="warningBanner" class="stage-warning">트윈을 생성하는 중입니다…</div>
      </main>

      <aside class="panel right-panel">
        <section class="panel-section">
          <div class="section-title">레이어 신뢰도</div>
          <div id="layerRows">${layerRows(manifest)}</div>
        </section>
        <section class="panel-section">
          <div class="section-title">베이스맵</div>
          <p class="attribution" id="basemapAttribution"></p>
        </section>
        <section class="panel-section">
          <div class="section-title">표시 설정</div>
          <button id="themeToggle" class="scenario-btn" type="button">🌙 야간 뷰</button>
          <button id="soundToggle" class="scenario-btn" type="button">🔊 사운드 켜짐</button>
        </section>
      </aside>

      <footer class="toolbar">
        ${TOOLS.map(
          (tool, index) =>
            `<button class="tool-btn${index === 0 ? " active" : ""}" data-tool="${tool.id}" type="button">${tool.label}</button>`
        ).join("")}
      </footer>
    </div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  };

  return {
    sceneHost: query("#sceneHost"),
    webglFallback: query("#webglFallback"),
    promptInput: query("#promptInput"),
    runButton: query("#runButton"),
    agentTranscript: query("#agentTranscript"),
    agentSteps: query("#agentSteps"),
    agentOutputs: query("#agentOutputs"),
    sourceStatus: query("#sourceStatus"),
    modelStatus: query("#modelStatus"),
    parcelAddress: query("#parcelAddress"),
    roadAddress: query("#roadAddress"),
    buildingName: query("#buildingName"),
    coordinates: query("#coordinates"),
    confidence: query("#confidence"),
    parcelBoundarySource: query("#parcelBoundarySource"),
    layerRows: query("#layerRows"),
    warningBanner: query("#warningBanner"),
    undergroundAlert: query("#undergroundAlert"),
    orbitButton: query("#orbitButton"),
    topButton: query("#topButton"),
    satelliteButton: query("#satelliteButton"),
    massButton: query("#massButton"),
    xrayButton: query("#xrayButton"),
    shadowButton: query("#shadowButton"),
    statSurface: query("#statSurface"),
    statPipe: query("#statPipe"),
    statUnderground: query("#statUnderground"),
    statOutflow: query("#statOutflow"),
    statOverflow: query("#statOverflow"),
    rainSlider: query("#rainSlider"),
    rainLabel: query("#rainLabel"),
    scenarioButtons: Array.from(app.querySelectorAll<HTMLButtonElement>("[data-scenario]")),
    dryButton: query("#dryButton"),
    inspectCoord: query("#inspectCoord"),
    inspectType: query("#inspectType"),
    inspectMeta: query("#inspectMeta"),
    inspectElevation: query("#inspectElevation"),
    inspectWater: query("#inspectWater"),
    inspectInfra: query("#inspectInfra"),
    inspectPipeWater: query("#inspectPipeWater"),
    gaugeDrainValue: query("#gaugeDrainValue"),
    gaugeDrainBar: query("#gaugeDrainBar"),
    gaugePressureValue: query("#gaugePressureValue"),
    gaugePressureBar: query("#gaugePressureBar"),
    gaugeVelocityValue: query("#gaugeVelocityValue"),
    gaugeVelocityBar: query("#gaugeVelocityBar"),
    chartCanvas: query("#chartCanvas"),
    logFeed: query("#logFeed"),
    basemapAttribution: query("#basemapAttribution"),
    themeToggle: query("#themeToggle"),
    soundToggle: query("#soundToggle"),
    toolButtons: Array.from(app.querySelectorAll<HTMLButtonElement>("[data-tool]"))
  };
}
