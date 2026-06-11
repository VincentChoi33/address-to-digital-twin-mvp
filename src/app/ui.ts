import { escapeHtml } from "../lib/html";
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
  layerRows: HTMLElement;
  warningBanner: HTMLElement;
  floodAlert: HTMLElement;

  orbitButton: HTMLButtonElement;
  topButton: HTMLButtonElement;
  buildingsButton: HTMLButtonElement;
  shadowButton: HTMLButtonElement;

  statVolume: HTMLElement;
  statFlooded: HTMLElement;
  statMaxDepth: HTMLElement;
  statNetwork: HTMLElement;
  statBackflow: HTMLElement;

  rainSlider: HTMLInputElement;
  rainLabel: HTMLElement;
  scenarioButtons: HTMLButtonElement[];
  dryButton: HTMLButtonElement;

  inspectTitle: HTMLElement;
  inspectGround: HTMLElement;
  inspectDepth: HTMLElement;
  inspectBuilding: HTMLElement;

  gaugeNetworkValue: HTMLElement;
  gaugeNetworkBar: HTMLElement;
  chartCanvas: HTMLCanvasElement;
  logFeed: HTMLElement;
  basemapAttribution: HTMLElement;
  soundToggle: HTMLButtonElement;
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

export function coordinateText(twin: TwinProject): string {
  return `${twin.center.lat.toFixed(5)}, ${twin.center.lon.toFixed(5)}`;
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

export interface ScenarioSpec {
  id: string;
  label: string;
  description: string;
}

export const SCENARIOS: ScenarioSpec[] = [
  { id: "clear", label: "기본 (Clear)", description: "강우 0, 지표 건조" },
  { id: "heavy", label: "집중호우 80mm/h", description: "장마철 강한 비" },
  { id: "cloudburst", label: "극한폭우 140mm/h", description: "2022 강남형 집중호우" },
  { id: "tunnel", label: "대심도 배수터널", description: "관거 용량 6배" }
];

export function createUi(app: HTMLElement, twin: TwinProject, manifest: SourceManifest): UiControls {
  app.innerHTML = `
    <div class="app-shell no-tools">
      <header class="topbar">
        <div class="brand">
          <h1>주소 → 디지털 트윈 · 침수 시뮬레이터</h1>
          <p>실측 건물·지형 위 GPU shallow-water 침수 해석</p>
        </div>
        <div class="topbar-stats">
          <div class="stat"><span>지표 수량</span><b id="statVolume" class="accent">0 ㎥</b></div>
          <div class="stat"><span>침수 면적 (&gt;10cm)</span><b id="statFlooded">0 ㎡</b></div>
          <div class="stat"><span>최대 수심</span><b id="statMaxDepth">0.00 m</b></div>
          <div class="stat"><span>관거 부하</span><b id="statNetwork">0%</b></div>
          <div class="stat"><span>맨홀 역류</span><b id="statBackflow">정상</b></div>
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
            <span>좌표</span><b id="coordinates">${coordinateText(twin)}</b>
            <span>신뢰도</span><b id="confidence">${confidenceKo(twin.geocoding.confidence)}</b>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">뷰 컨트롤</div>
          <div class="control-grid">
            <button id="orbitButton" class="active" type="button">궤도 보기</button>
            <button id="topButton" type="button">정사 상단</button>
            <button id="buildingsButton" class="active" type="button">건물</button>
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
          <button class="reset-btn" id="dryButton" type="button">🧹 지표 건조 (Reset)</button>
        </section>

        <section class="panel-section">
          <div class="section-title">선택 지점</div>
          <div class="info-card">
            <div class="info-title" id="inspectTitle">씬을 클릭해 지점을 검사하세요</div>
            <div class="info-row"><span>지반 표고</span><span id="inspectGround">-</span></div>
            <div class="info-row"><span>침수 수심</span><span id="inspectDepth" class="accent">-</span></div>
            <div class="info-row"><span>건물</span><span id="inspectBuilding">-</span></div>
          </div>
        </section>

        <section class="panel-section">
          <div class="section-title">하수 관거 부하</div>
          <div class="info-card gauges">
            <div>
              <div class="info-row"><span>네트워크 용량 대비</span><span id="gaugeNetworkValue">0%</span></div>
              <div class="gauge-track"><div class="gauge-bar" id="gaugeNetworkBar"></div></div>
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
            <div class="log-item info">시뮬레이터 준비 중…</div>
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
        <div id="floodAlert" class="stage-alert" hidden>🚨 도로 침수 진행 — 맨홀 역류 발생 🚨</div>
        <div class="legend">
          <div><span class="chip target"></span>대상 건물</div>
          <div><span class="chip context"></span>실측 건물 (WFS)</div>
          <div><span class="chip drain"></span>빗물받이</div>
          <div><span class="chip water"></span>침수 (얕음→깊음)</div>
        </div>
        <div id="warningBanner" class="stage-warning">트윈을 생성하는 중입니다…</div>
      </main>

      <aside class="panel right-panel">
        <section class="panel-section">
          <div class="section-title">레이어 신뢰도</div>
          <div id="layerRows">${layerRows(manifest)}</div>
        </section>
        <section class="panel-section">
          <div class="section-title">데이터 출처</div>
          <p class="attribution" id="basemapAttribution"></p>
          <p class="attribution">지형: AWS Terrain Tiles (terrarium) · 건물/도로: VWorld WFS / OSM · 물: GPU shallow-water (시연용 가속)</p>
        </section>
        <section class="panel-section">
          <div class="section-title">설정</div>
          <button id="soundToggle" class="scenario-btn" type="button">🔊 사운드 켜짐</button>
        </section>
      </aside>
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
    layerRows: query("#layerRows"),
    warningBanner: query("#warningBanner"),
    floodAlert: query("#floodAlert"),
    orbitButton: query("#orbitButton"),
    topButton: query("#topButton"),
    buildingsButton: query("#buildingsButton"),
    shadowButton: query("#shadowButton"),
    statVolume: query("#statVolume"),
    statFlooded: query("#statFlooded"),
    statMaxDepth: query("#statMaxDepth"),
    statNetwork: query("#statNetwork"),
    statBackflow: query("#statBackflow"),
    rainSlider: query("#rainSlider"),
    rainLabel: query("#rainLabel"),
    scenarioButtons: Array.from(app.querySelectorAll<HTMLButtonElement>("[data-scenario]")),
    dryButton: query("#dryButton"),
    inspectTitle: query("#inspectTitle"),
    inspectGround: query("#inspectGround"),
    inspectDepth: query("#inspectDepth"),
    inspectBuilding: query("#inspectBuilding"),
    gaugeNetworkValue: query("#gaugeNetworkValue"),
    gaugeNetworkBar: query("#gaugeNetworkBar"),
    chartCanvas: query("#chartCanvas"),
    logFeed: query("#logFeed"),
    basemapAttribution: query("#basemapAttribution"),
    soundToggle: query("#soundToggle")
  };
}
