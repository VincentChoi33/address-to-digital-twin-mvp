import { escapeHtml } from "../lib/html";
import { getNvidiaVisualArtifacts, nvidiaEvidenceHtml } from "./nvidiaEvidence";
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
  readinessPill: HTMLElement;
  readinessDetail: HTMLElement;
  stageAddress: HTMLElement;
  scenarioNarrative: HTMLElement;
  riskCard: HTMLElement;
  riskLevel: HTMLElement;
  riskReason: HTMLElement;
  riskBar: HTMLElement;

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

  nvidiaResultViewer: HTMLElement;
  nvidiaResultTitle: HTMLElement;
  nvidiaResultProduct: HTMLElement;
  nvidiaResultStatus: HTMLElement;
  nvidiaStaticFrame: HTMLElement;
  nvidiaLiveFrame: HTMLIFrameElement;
  nvidiaLiveButton: HTMLButtonElement;
  nvidiaLiveOpenLink: HTMLAnchorElement;
  nvidiaResultImage: HTMLImageElement;
  nvidiaResultWarpOverlay: HTMLImageElement;
  nvidiaResultLayerNote: HTMLElement;
  nvidiaResultCaption: HTMLElement;
  nvidiaResultEvidence: HTMLElement;
  nvidiaResultSource: HTMLElement;
  nvidiaResultClose: HTMLButtonElement;
  nvidiaVisualButtons: HTMLButtonElement[];
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

function confidenceWeight(value: string | undefined): number {
  if (value === "high") return 1;
  if (value === "medium") return 0.62;
  return 0.26;
}

export interface DataReadinessSummary {
  score: number;
  label: string;
  tone: "ready" | "mixed" | "preview";
  detail: string;
}

export function dataReadinessSummary(manifest: SourceManifest): DataReadinessSummary {
  const layers = manifest.layers;
  if (layers.length === 0) {
    return {
      score: 0,
      label: "레이어 없음",
      tone: "preview",
      detail: "검증 가능한 레이어가 아직 없습니다."
    };
  }

  const counts = { high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const layer of layers) {
    const confidence = layer.confidence ?? "low";
    if (confidence === "high") counts.high += 1;
    else if (confidence === "medium") counts.medium += 1;
    else counts.low += 1;
    total += confidenceWeight(confidence);
  }

  const score = Math.round((total / layers.length) * 100);
  if (score >= 78) {
    return {
      score,
      label: "검증 우수",
      tone: "ready",
      detail: `${counts.high}개 high · ${counts.medium}개 medium · ${counts.low}개 low`
    };
  }
  if (score >= 52) {
    return {
      score,
      label: "검증 혼합",
      tone: "mixed",
      detail: `${counts.high}개 high · ${counts.medium}개 medium · ${counts.low}개 low — 공식/프리뷰 레이어를 구분해 보세요.`
    };
  }
  return {
    score,
    label: "프리뷰 주의",
    tone: "preview",
    detail: `${counts.low}개 low-confidence 레이어 포함 — 공식 데이터 연결 전 의사결정 금지.`
  };
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

export function scenarioNarrativeText(id: string, rainMmPerHour: number): string {
  if (id === "clear") return "현재는 기준 상태입니다. 지표수를 리셋하고 데이터 신뢰도와 주소 판정을 먼저 확인하세요.";
  if (id === "heavy") return "80mm/h 집중호우: 도로 저점과 배수구 주변의 초기 체수 여부를 관찰합니다.";
  if (id === "cloudburst") return "140mm/h 극한폭우: 관거 포화와 맨홀 역류가 발생하는지 확인하는 스트레스 테스트입니다.";
  if (id === "tunnel") return "배수터널 가정: 관거 용량을 크게 늘렸을 때 침수 면적과 부하가 얼마나 줄어드는지 비교합니다.";
  if (rainMmPerHour > 0) return `${rainMmPerHour}mm/h 사용자 강우: 수동 조정 상태입니다. 공식 설계강우와 비교해 해석하세요.`;
  return "시나리오를 선택하거나 강우량을 조정하면 이곳에 해석 포인트가 표시됩니다.";
}

export interface FloodRiskInput {
  floodedAreaM2: number;
  maxDepthM: number;
  volumeM3: number;
}

export interface FloodRiskSummary {
  level: "standby" | "watch" | "warning" | "critical";
  label: string;
  detail: string;
  percent: number;
}

export function floodRiskSummary(
  stats: FloodRiskInput | null,
  networkLoad: number,
  backflowActive: boolean
): FloodRiskSummary {
  if (!stats) {
    return {
      level: "standby",
      label: "대기",
      detail: "시뮬레이션 통계가 들어오면 침수 위험 판정이 갱신됩니다.",
      percent: 4
    };
  }

  const floodedScore = Math.min(1, stats.floodedAreaM2 / 3000);
  const depthScore = Math.min(1, stats.maxDepthM / 0.6);
  const loadScore = Math.min(1, networkLoad);
  const score = Math.max(floodedScore, depthScore, loadScore, backflowActive ? 1 : 0);
  const percent = Math.round(score * 100);

  if (backflowActive || stats.maxDepthM >= 0.5 || stats.floodedAreaM2 >= 2500) {
    return {
      level: "critical",
      label: "위험",
      detail: `맨홀 역류 또는 깊은 침수 조건입니다. 최대 ${stats.maxDepthM.toFixed(2)}m · 침수 ${stats.floodedAreaM2.toFixed(0)}㎡.`,
      percent
    };
  }
  if (networkLoad >= 0.85 || stats.maxDepthM >= 0.25 || stats.floodedAreaM2 >= 1000) {
    return {
      level: "warning",
      label: "경계",
      detail: `배수 여유가 낮거나 도로 체수가 커지고 있습니다. 관거 부하 ${Math.round(networkLoad * 100)}%.`,
      percent
    };
  }
  if (stats.floodedAreaM2 >= 120 || stats.maxDepthM >= 0.08 || stats.volumeM3 >= 40) {
    return {
      level: "watch",
      label: "주의",
      detail: `얕은 체수가 감지됩니다. 최대 ${stats.maxDepthM.toFixed(2)}m, 지표수 ${stats.volumeM3.toFixed(0)}㎥.`,
      percent: Math.max(18, percent)
    };
  }
  return {
    level: "standby",
    label: "안정",
    detail: "현재 통계상 의미 있는 침수는 감지되지 않았습니다.",
    percent: Math.max(6, percent)
  };
}

function missionSteps(): string {
  const steps = [
    ["01", "주소 해석", "Juso/VWorld가 없으면 결정적 프리뷰 좌표로 즉시 진행"],
    ["02", "레이어 신뢰도", "공식·OSM·절차적 fallback을 분리 표시"],
    ["03", "트윈 생성", "건물/도로/지형을 시뮬레이션 도메인에 배치"],
    ["04", "강우 시나리오", "관거 포화와 맨홀 역류를 라이브 통계로 추적"],
    ["05", "NVIDIA 산출물", "OpenUSD·ovrtx·Warp·Content Agents·SimReady 증거 표시"]
  ];
  return steps
    .map(
      ([index, title, copy]) => `
        <div class="mission-step">
          <b>${index}</b>
          <span><strong>${title}</strong><small>${copy}</small></span>
        </div>
      `
    )
    .join("");
}

export function createUi(app: HTMLElement, twin: TwinProject, manifest: SourceManifest): UiControls {
  const readiness = dataReadinessSummary(manifest);
  const defaultNvidiaVisual = getNvidiaVisualArtifacts()[0];
  app.innerHTML = `
    <div class="app-shell">
      <header class="command-bar">
        <div class="brand-lockup">
          <span class="eyebrow">NVIDIA OpenUSD evidence + local preview</span>
          <h1>주소 기반 침수 리스크 트윈</h1>
          <p>주소 입력부터 데이터 신뢰도, 강우 시나리오, NVIDIA 산출물 증거까지 한 화면에서 검토합니다.</p>
        </div>
        <div class="topbar-stats" aria-label="실시간 침수 통계">
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

      <aside class="panel mission-panel" aria-label="주소와 시나리오 제어">
        <section class="hero-card">
          <div class="hero-card-header">
            <span id="readinessPill" class="readiness-pill ${readiness.tone}">${readiness.label} · ${readiness.score}</span>
            <span class="kbd-hint">⌘/Ctrl + Enter</span>
          </div>
          <label class="section-title" for="promptInput">분석할 주소</label>
          <div class="agent-console">
            <textarea id="promptInput" rows="3" placeholder="예: 서울 강남구 테헤란로 152 디지털 트윈 만들어줘"></textarea>
            <button id="runButton" type="button">트윈 생성 · 분석 시작</button>
          </div>
          <p id="readinessDetail" class="readiness-detail">${escapeHtml(readiness.detail)}</p>
        </section>

        <section class="panel-section workflow-card">
          <div class="section-title">작동 흐름</div>
          <div class="mission-steps">${missionSteps()}</div>
        </section>

        <section class="panel-section">
          <div class="section-title">주소 판정</div>
          <div class="meta-grid">
            <span>지번</span><b id="parcelAddress">${escapeHtml(twin.addresses.parcel_address)}</b>
            <span>도로명</span><b id="roadAddress">${escapeHtml(twin.addresses.road_address_candidate)}</b>
            <span>건물명</span><b id="buildingName">${escapeHtml(twin.addresses.building_name_candidate)}</b>
            <span>좌표</span><b id="coordinates">${coordinateText(twin)}</b>
            <span>좌표 신뢰도</span><b id="confidence">${confidenceKo(twin.geocoding.confidence)}</b>
          </div>
        </section>

        <section class="panel-section scenario-card">
          <div class="section-title">재난 시나리오</div>
          <p id="scenarioNarrative" class="scenario-narrative">${scenarioNarrativeText("clear", 0)}</p>
          <div class="rain-row">
            <span id="rainLabel">맑음 (0mm/h)</span>
            <input id="rainSlider" type="range" min="0" max="150" value="0" aria-label="강우량" />
          </div>
          <div class="scenario-grid">
            ${SCENARIOS.map(
              (scenario, index) =>
                `<button class="scenario-btn${index === 0 ? " active" : ""}" data-scenario="${scenario.id}" title="${escapeHtml(scenario.description)}" type="button">${escapeHtml(scenario.label)}</button>`
            ).join("")}
          </div>
          <button class="reset-btn" id="dryButton" type="button">🧹 지표 건조 (Reset)</button>
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
      </aside>

      <main class="stage" aria-label="NVIDIA-only 융합 디지털 트윈 결과">
        <div id="sceneHost" class="scene-host"></div>
        <div id="webglFallback" class="webgl-fallback" hidden>
          <b>3D 미리보기를 사용할 수 없습니다</b>
          <p>이 브라우저/환경에서 WebGL 컨텍스트를 만들 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저에서 열어 주세요.
          주소 분석과 산출물(트윈 JSON·QA 리포트) 생성은 계속 사용할 수 있습니다.</p>
        </div>
        <div id="floodAlert" class="stage-alert" hidden>🚨 도로 침수 진행 — 맨홀 역류 발생 🚨</div>
        <div class="stage-hud">
          <span>현재 분석 주소</span>
          <b id="stageAddress">${escapeHtml(twin.addresses.parcel_address)}</b>
          <small>로컬 Three.js 비교 레이어입니다. 기본 메인은 NVIDIA-only 융합 결과입니다.</small>
        </div>
        <div class="legend">
          <div><span class="chip target"></span>대상 건물</div>
          <div><span class="chip context"></span>실측/주변 건물</div>
          <div><span class="chip drain"></span>빗물받이</div>
          <div><span class="chip water"></span>침수 깊이</div>
        </div>
        <div class="orientation-overlay" aria-label="지도 방향 기준">
          <b>지도 기준</b>
          <span><strong>N</strong> = 로컬 +Z · 위성 타일 북쪽</span>
          <span><strong>E</strong> = 로컬 +X · 경도 증가</span>
          <small>WFS/필지 좌표가 정렬 기준, 위성은 드레이프 텍스처</small>
        </div>
        <div id="warningBanner" class="stage-warning">트윈을 생성하는 중입니다…</div>
        <div id="nvidiaResultViewer" class="nvidia-result-viewer" aria-label="NVIDIA-only 융합 결과 메인 뷰어">
          <div class="nvidia-result-top">
            <div>
              <span id="nvidiaResultProduct">${escapeHtml(defaultNvidiaVisual.product)}</span>
              <b id="nvidiaResultTitle">${escapeHtml(defaultNvidiaVisual.title)}</b>
            </div>
            <span id="nvidiaResultStatus" class="nvidia-result-status">${escapeHtml(defaultNvidiaVisual.status)}</span>
            <button id="nvidiaLiveButton" type="button">Live ovstream 조작</button>
            <a id="nvidiaLiveOpenLink" class="nvidia-result-link" href="#" target="_blank" rel="noreferrer">새 탭</a>
            <button id="nvidiaResultClose" type="button">로컬 Three.js 비교 보기</button>
          </div>
          <div id="nvidiaStaticFrame" class="nvidia-result-frame">
            <img id="nvidiaResultImage" src="${escapeHtml(defaultNvidiaVisual.imageUrl)}" alt="${escapeHtml(defaultNvidiaVisual.title)}" />
            <img id="nvidiaResultWarpOverlay" class="nvidia-warp-overlay" src="${escapeHtml(defaultNvidiaVisual.warpOverlayUrl ?? "")}" alt="NVIDIA Warp/CUDA flood depth overlay" />
            <div class="nvidia-fusion-badge">
              <b>NVIDIA-only fused main</b>
              <span id="nvidiaResultLayerNote">RTX frame + Warp depth + Content Agents material/physics + SimReady validator</span>
            </div>
          </div>
          <iframe id="nvidiaLiveFrame" class="nvidia-live-frame" title="NVIDIA ovstream live interactive viewer" hidden></iframe>
          <div class="nvidia-result-copy">
            <p id="nvidiaResultCaption">${escapeHtml(defaultNvidiaVisual.caption)}</p>
            <small id="nvidiaResultEvidence">${escapeHtml(defaultNvidiaVisual.evidence)}</small>
            <code id="nvidiaResultSource">${escapeHtml(defaultNvidiaVisual.sourcePath)}</code>
          </div>
        </div>
      </main>

      <aside class="panel intelligence-panel" aria-label="위험도와 산출물">
        <section id="riskCard" class="risk-card standby">
          <div class="risk-card-top">
            <span class="section-title">침수 위험 판정</span>
            <b id="riskLevel">대기</b>
          </div>
          <p id="riskReason">시뮬레이션 통계가 들어오면 침수 위험 판정이 갱신됩니다.</p>
          <div class="risk-meter"><div id="riskBar"></div></div>
        </section>

        <section class="panel-section nvidia-card">
          <div class="section-title">NVIDIA로 실제 만든 것</div>
          ${nvidiaEvidenceHtml()}
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
          <div class="section-title">레이어 신뢰도</div>
          <div id="layerRows" class="layer-list">${layerRows(manifest)}</div>
        </section>

        <section class="panel-section output-card">
          <div class="section-title">검토 산출물</div>
          <div id="agentOutputs" class="agent-outputs"></div>
        </section>

        <section class="panel-section trace-card">
          <div class="section-title">분석 추적</div>
          <div id="agentTranscript" class="agent-transcript" aria-live="polite"></div>
          <div id="agentSteps" class="agent-steps"></div>
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

        <section class="panel-section data-source-card">
          <div class="section-title">데이터 출처 · 설정</div>
          <p class="attribution" id="basemapAttribution"></p>
          <p class="attribution">지형: AWS Terrain Tiles (terrarium) · 건물/도로: VWorld WFS / OSM · 물: GPU shallow-water (시연용 가속)</p>
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
    readinessPill: query("#readinessPill"),
    readinessDetail: query("#readinessDetail"),
    stageAddress: query("#stageAddress"),
    scenarioNarrative: query("#scenarioNarrative"),
    riskCard: query("#riskCard"),
    riskLevel: query("#riskLevel"),
    riskReason: query("#riskReason"),
    riskBar: query("#riskBar"),
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
    soundToggle: query("#soundToggle"),
    nvidiaResultViewer: query("#nvidiaResultViewer"),
    nvidiaResultTitle: query("#nvidiaResultTitle"),
    nvidiaResultProduct: query("#nvidiaResultProduct"),
    nvidiaResultStatus: query("#nvidiaResultStatus"),
    nvidiaStaticFrame: query("#nvidiaStaticFrame"),
    nvidiaLiveFrame: query("#nvidiaLiveFrame"),
    nvidiaLiveButton: query("#nvidiaLiveButton"),
    nvidiaLiveOpenLink: query("#nvidiaLiveOpenLink"),
    nvidiaResultImage: query("#nvidiaResultImage"),
    nvidiaResultWarpOverlay: query("#nvidiaResultWarpOverlay"),
    nvidiaResultLayerNote: query("#nvidiaResultLayerNote"),
    nvidiaResultCaption: query("#nvidiaResultCaption"),
    nvidiaResultEvidence: query("#nvidiaResultEvidence"),
    nvidiaResultSource: query("#nvidiaResultSource"),
    nvidiaResultClose: query("#nvidiaResultClose"),
    nvidiaVisualButtons: Array.from(app.querySelectorAll<HTMLButtonElement>("[data-nvidia-visual]"))
  };
}
