import type { SourceManifest, TwinProject } from "../types/twin";

export interface ViewerControls {
  sceneHost: HTMLElement;
  promptInput: HTMLTextAreaElement;
  runButton: HTMLButtonElement;
  agentTranscript: HTMLElement;
  agentSteps: HTMLElement;
  agentOutputs: HTMLElement;
  orbitButton: HTMLButtonElement;
  topButton: HTMLButtonElement;
  satelliteButton: HTMLButtonElement;
  massButton: HTMLButtonElement;
  xrayButton: HTMLButtonElement;
  shadowButton: HTMLButtonElement;
  offsetX: HTMLInputElement;
  offsetZ: HTMLInputElement;
  offsetXValue: HTMLElement;
  offsetZValue: HTMLElement;
  sourceStatus: HTMLElement;
  modelStatus: HTMLElement;
  parcelAddress: HTMLElement;
  roadAddress: HTMLElement;
  buildingName: HTMLElement;
  coordinates: HTMLElement;
  confidence: HTMLElement;
  parcelBoundarySource: HTMLElement;
  layerRows: HTMLElement;
  inlineWarning: HTMLElement;
  warningBanner: HTMLElement;

  // Hydrology Simulation Added UI Elements
  lightningOverlay: HTMLElement;
  subwayAlertBanner: HTMLElement;
  surfaceWaterDisplay: HTMLElement;
  pipeWaterDisplay: HTMLElement;
  subwayWaterDisplay: HTMLElement;
  outflowDisplay: HTMLElement;
  overflowDisplay: HTMLElement;
  
  rainSlider: HTMLInputElement;
  rainLabel: HTMLElement;
  
  scenNormal: HTMLButtonElement;
  scen2022: HTMLButtonElement;
  scenExpand: HTMLButtonElement;
  scenTunnel: HTMLButtonElement;
  btnDryGrid: HTMLButtonElement;
  
  inspectCellCoord: HTMLElement;
  inspectType: HTMLElement;
  inspectMetadata: HTMLElement;
  inspectElevation: HTMLElement;
  inspectWater: HTMLElement;
  inspectSewer: HTMLElement;
  inspectPipe: HTMLElement;
  inspectPipeWater: HTMLElement;
  
  gaugeDrainVal: HTMLElement;
  gaugeDrainBar: HTMLElement;
  gaugePressureVal: HTMLElement;
  gaugePressureBar: HTMLElement;
  gaugeVelocityVal: HTMLElement;
  gaugeVelocityBar: HTMLElement;
  
  logFeed: HTMLElement;
  themeToggleBtn: HTMLButtonElement;

  toolInspect: HTMLButtonElement;
  toolRoad: HTMLButtonElement;
  toolBuilding: HTMLButtonElement;
  toolSewer: HTMLButtonElement;
  toolPipe: HTMLButtonElement;
  toolOutfall: HTMLButtonElement;
  toolRaise: HTMLButtonElement;
  toolLower: HTMLButtonElement;
  toolEraser: HTMLButtonElement;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

export function createUi(app: HTMLElement, twin: TwinProject, manifest: SourceManifest): ViewerControls {
  app.innerHTML = `
    <div class="viewer-shell">
      <div id="lightning-overlay"></div>

      <!-- Subway Inundation Alarm Banner -->
      <div id="subway-alert-banner">
        <span>🚨 EMERGENCY: 지하철 역사 내 빗물 유입! 지하철 침수 차오름 발생! 🚨</span>
      </div>

      <div id="sceneHost" class="scene-host"></div>

      <!-- Top Dashboard (Flow Stats HUD) -->
      <header class="hud-panel">
        <div class="stats-bar">
          <div class="stat-item">
            <span class="stat-label">지상 우수 유량</span>
            <span class="stat-value accent" id="surface-water-display">0.0 ㎥</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">지하 하수관 유량</span>
            <span class="stat-value success" id="pipe-water-display">0.0 ㎥</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">지하철 침수 유수량</span>
            <span class="stat-value success" id="subway-water-display">0.0 ㎥</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">누적 방류량</span>
            <span class="stat-value success" id="outflow-display">0.0 ㎥</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">역류 맨홀</span>
            <span class="stat-value success" id="overflow-display">0</span>
          </div>
        </div>
      </header>

      <section class="panel main-panel" aria-label="프로젝트 정보" style="z-index:10;">
        <div class="title-row">
          <div>
            <h1>디지털 트윈 수리학 시뮬레이터</h1>
            <p>실시간 GIS 및 Open-Meteo 지형 연동 침수 분석 플랫폼</p>
          </div>
          <div class="status-stack">
            <span id="sourceStatus" class="status-pill source-status pending">
              공간 데이터 확인 중
            </span>
            <span id="modelStatus" class="status-pill model-status pending">LLM 확인 중</span>
          </div>
        </div>
        <div id="inlineWarning" class="inline-warning">Juso/VWorld/WFS/Gemma 연결 상태를 확인하고 있습니다.</div>
        
        <div class="agent-console" aria-label="AI 주소 요청 콘솔">
          <label for="promptInput">AI 위치 검색 및 트윈 생성</label>
          <textarea id="promptInput" rows="2">강남역</textarea>
          <button id="runButton" type="button">트윈 생성</button>
        </div>
        <div id="agentTranscript" class="agent-transcript" aria-live="polite"></div>
        <div id="agentSteps" class="agent-steps"></div>
        <div id="agentOutputs" class="agent-outputs"></div>
        
        <div class="meta-grid">
          <span>지번</span><b id="parcelAddress">${escapeHtml(twin.addresses.parcel_address)}</b>
          <span>도로명</span><b id="roadAddress">${escapeHtml(twin.addresses.road_address_candidate)}</b>
          <span>건물명</span><b id="buildingName">${escapeHtml(twin.addresses.building_name_candidate)}</b>
          <span>기준점</span><b id="coordinates">${coordinateText(twin)}</b>
          <span>신뢰도</span><b id="confidence">${confidenceKo(twin.geocoding.confidence)}</b>
          <span>필지 경계</span><b id="parcelBoundarySource">${sourceTypeKo(twin.parcel.source_type)} / ${confidenceKo(twin.parcel.confidence)}</b>
        </div>
        
        <div class="control-grid">
          <button id="orbitButton" class="active" type="button">궤도 보기</button>
          <button id="topButton" type="button">정사 상단</button>
          <button id="satelliteButton" type="button">위성</button>
          <button id="massButton" class="active" type="button">3D 매스</button>
          <button id="xrayButton" type="button">X-Ray</button>
          <button id="shadowButton" class="active" type="button">그림자</button>
        </div>
        
        <div class="slider-box">
          <label class="slider-row">
            <span>동/서 편차</span>
            <input id="offsetX" type="range" min="-12" max="12" value="0" step="0.5" />
            <b id="offsetXValue">0m</b>
          </label>
          <label class="slider-row">
            <span>남/북 편차</span>
            <input id="offsetZ" type="range" min="-12" max="12" value="0" step="0.5" />
            <b id="offsetZValue">0m</b>
          </label>
        </div>

        <!-- ==========================================
             SIMULATOR CONTROL SECTIONS (ADDITIONS)
             ========================================== -->
        
        <div class="section-title">기상 강우량 통제 (Rainfall)</div>
        <div class="info-card">
          <div class="slider-box" style="margin-top: 0; padding-top: 0; border: 0;">
            <label class="slider-row" style="grid-template-columns: 1fr 120px;">
              <span id="rain-label" style="font-weight: 700;">맑음 (0mm/h)</span>
              <input id="rain-slider" type="range" min="0" max="150" value="0" />
            </label>
          </div>
        </div>

        <div class="section-title">재난 시나리오 프리셋</div>
        <div class="info-card">
          <div class="scenario-grid">
            <button class="scenario-btn active" id="scen-normal">기본 (Clear)</button>
            <button class="scenario-btn" id="scen-2022">2022 강남폭우</button>
            <button class="scenario-btn" id="scen-expand">하수도 2배 확장</button>
            <button class="scenario-btn" id="scen-tunnel">대심도 배수터널</button>
          </div>
          <button class="reset-btn" id="btn-dry-grid" style="margin-top: 8px;">🧹 지표 건조 (Dry Grid)</button>
        </div>

        <div class="section-title">선택 격자 데이터 검사 (GIS)</div>
        <div class="info-card" id="inspector-card">
          <div class="info-title" id="inspect-cell-coord">선택된 격자 없음</div>
          <div class="info-row">
            <span>격자 유형 (Ground)</span>
            <span id="inspect-type">-</span>
          </div>
          <div class="info-row">
            <span>대장 메타데이터</span>
            <span id="inspect-metadata" style="color:#fff; font-size:10.5px;">-</span>
          </div>
          <div class="info-row">
            <span>표고 고도 (Elevation)</span>
            <span id="inspect-elevation">-</span>
          </div>
          <div class="info-row">
            <span>지상 수고 (Surface Water)</span>
            <span id="inspect-water" style="color: var(--hydrology-accent); font-weight: bold;">-</span>
          </div>
          <div class="info-row">
            <span>하수구 / 지하철입구</span>
            <span id="inspect-sewer">-</span>
          </div>
          <div class="info-row">
            <span>지하 배수관 파이프</span>
            <span id="inspect-pipe" style="color: var(--hydrology-success); font-weight: bold;">-</span>
          </div>
          <div class="info-row">
            <span>관내 우수 (Pipe Water)</span>
            <span id="inspect-pipe-water">-</span>
          </div>
        </div>

        <div class="section-title">수리 수문 계측 센서</div>
        <div class="info-card" style="gap: 8px;">
          <div>
            <div class="info-row">
              <span>우수 배수 효율 (Drain Efficiency)</span>
              <span id="gauge-drain-val">0%</span>
            </div>
            <div class="gauge-bar-container">
              <div class="gauge-bar" id="gauge-drain-bar"></div>
            </div>
          </div>
          <div>
            <div class="info-row">
              <span>지하 관거 수압 부하 (Pressure Load)</span>
              <span id="gauge-pressure-val">0%</span>
            </div>
            <div class="gauge-bar-container">
              <div class="gauge-bar" id="gauge-pressure-bar"></div>
            </div>
          </div>
          <div>
            <div class="info-row">
              <span>방류구 분출 유속 (Discharge Speed)</span>
              <span id="gauge-velocity-val">0.0 m/s</span>
            </div>
            <div class="gauge-bar-container">
              <div class="gauge-bar" id="gauge-velocity-bar"></div>
            </div>
          </div>
        </div>

        <div class="section-title">실시간 수문 하이드로그래프</div>
        <div class="chart-container">
          <canvas id="hydrograph-canvas"></canvas>
        </div>

        <div class="section-title">수문 모니터 로그</div>
        <div class="log-feed" id="log-feed">
          <div class="log-item info">도시 지형 수리학 연동 레이어 바인딩 완료.</div>
        </div>
      </section>

      <aside class="panel layer-panel" aria-label="레이어 신뢰도" style="top:90px;">
        <strong>레이어 신뢰도</strong>
        <div id="layerRows">${layerRows(manifest)}</div>
        <button id="btn-theme-toggle" class="scenario-btn" style="width: 100%; margin-top: 10px; font-weight: bold;">☀️ 주간 뷰</button>
      </aside>

      <aside class="legend">
        <strong>범례</strong>
        <div><span class="chip target"></span>대상 건물</div>
        <div><span class="chip footprint"></span>건물 footprint 기준선</div>
        <div><span class="chip context"></span>주변 매스(WFS/OSM 또는 fallback)</div>
        <div><span class="chip parcel"></span>필지 경계(공식/추정)</div>
        <div><span class="chip road"></span>도로 힌트</div>
      </aside>

      <div class="attribution" style="top:360px;">
        배경 타일: VWorld WMTS/ArcGIS World Imagery 실시간 동기화. 물 흐름: 2D Shallow Water Gravity Routing 수리학 해석.
      </div>
      <div id="warningBanner" class="warning" style="bottom: 74px;">Juso/VWorld/WFS/Gemma 연결 상태를 확인하고 있습니다.</div>

      <!-- Bottom Editing Toolbar -->
      <footer class="hud-panel">
        <button class="tool-btn active" id="tool-inspect">🔍 격자 관찰</button>
        <div class="divider"></div>
        <button class="tool-btn" id="tool-road">🛣️ 도로 포장</button>
        <button class="tool-btn" id="tool-building">🏢 건물 건설</button>
        <button class="tool-btn" id="tool-sewer">🕳️ 하수 빗물받이</button>
        <button class="tool-btn" id="tool-pipe">⚙️ 지하 배수관</button>
        <button class="tool-btn" id="tool-outfall">🌊 방류 토구</button>
        <div class="divider"></div>
        <button class="tool-btn" id="tool-raise">🔺 고도 상승</button>
        <button class="tool-btn" id="tool-lower">🔻 고도 하강</button>
        <div class="divider"></div>
        <button class="tool-btn" id="tool-eraser">🧹 지우개</button>
      </footer>
    </div>
  `;

  return {
    sceneHost: app.querySelector("#sceneHost")!,
    promptInput: app.querySelector("#promptInput")!,
    runButton: app.querySelector("#runButton")!,
    agentTranscript: app.querySelector("#agentTranscript")!,
    agentSteps: app.querySelector("#agentSteps")!,
    agentOutputs: app.querySelector("#agentOutputs")!,
    orbitButton: app.querySelector("#orbitButton")!,
    topButton: app.querySelector("#topButton")!,
    satelliteButton: app.querySelector("#satelliteButton")!,
    massButton: app.querySelector("#massButton")!,
    xrayButton: app.querySelector("#xrayButton")!,
    shadowButton: app.querySelector("#shadowButton")!,
    offsetX: app.querySelector("#offsetX")!,
    offsetZ: app.querySelector("#offsetZ")!,
    offsetXValue: app.querySelector("#offsetXValue")!,
    offsetZValue: app.querySelector("#offsetZValue")!,
    sourceStatus: app.querySelector("#sourceStatus")!,
    modelStatus: app.querySelector("#modelStatus")!,
    parcelAddress: app.querySelector("#parcelAddress")!,
    roadAddress: app.querySelector("#roadAddress")!,
    buildingName: app.querySelector("#buildingName")!,
    coordinates: app.querySelector("#coordinates")!,
    confidence: app.querySelector("#confidence")!,
    parcelBoundarySource: app.querySelector("#parcelBoundarySource")!,
    layerRows: app.querySelector("#layerRows")!,
    inlineWarning: app.querySelector("#inlineWarning")!,
    warningBanner: app.querySelector("#warningBanner")!,

    // Hydrology Simulation DOM Query Bindings
    lightningOverlay: app.querySelector("#lightning-overlay")!,
    subwayAlertBanner: app.querySelector("#subway-alert-banner")!,
    surfaceWaterDisplay: app.querySelector("#surface-water-display")!,
    pipeWaterDisplay: app.querySelector("#pipe-water-display")!,
    subwayWaterDisplay: app.querySelector("#subway-water-display")!,
    outflowDisplay: app.querySelector("#outflow-display")!,
    overflowDisplay: app.querySelector("#overflow-display")!,
    
    rainSlider: app.querySelector("#rain-slider")!,
    rainLabel: app.querySelector("#rain-label")!,
    
    scenNormal: app.querySelector("#scen-normal")!,
    scen2022: app.querySelector("#scen-2022")!,
    scenExpand: app.querySelector("#scen-expand")!,
    scenTunnel: app.querySelector("#scen-tunnel")!,
    btnDryGrid: app.querySelector("#btn-dry-grid")!,
    
    inspectCellCoord: app.querySelector("#inspect-cell-coord")!,
    inspectType: app.querySelector("#inspect-type")!,
    inspectMetadata: app.querySelector("#inspect-metadata")!,
    inspectElevation: app.querySelector("#inspect-elevation")!,
    inspectWater: app.querySelector("#inspect-water")!,
    inspectSewer: app.querySelector("#inspect-sewer")!,
    inspectPipe: app.querySelector("#inspect-pipe")!,
    inspectPipeWater: app.querySelector("#inspect-pipe-water")!,
    
    gaugeDrainVal: app.querySelector("#gauge-drain-val")!,
    gaugeDrainBar: app.querySelector("#gauge-drain-bar")!,
    gaugePressureVal: app.querySelector("#gauge-pressure-val")!,
    gaugePressureBar: app.querySelector("#gauge-pressure-bar")!,
    gaugeVelocityVal: app.querySelector("#gauge-velocity-val")!,
    gaugeVelocityBar: app.querySelector("#gauge-velocity-bar")!,
    
    logFeed: app.querySelector("#log-feed")!,
    themeToggleBtn: app.querySelector("#btn-theme-toggle")!,

    toolInspect: app.querySelector("#tool-inspect")!,
    toolRoad: app.querySelector("#tool-road")!,
    toolBuilding: app.querySelector("#tool-building")!,
    toolSewer: app.querySelector("#tool-sewer")!,
    toolPipe: app.querySelector("#tool-pipe")!,
    toolOutfall: app.querySelector("#tool-outfall")!,
    toolRaise: app.querySelector("#tool-raise")!,
    toolLower: app.querySelector("#tool-lower")!,
    toolEraser: app.querySelector("#tool-eraser")!
  };
}

