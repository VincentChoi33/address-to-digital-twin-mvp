import sadangTwin from "../samples/sadang_317_6/twin.json";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import type { SourceManifest, TwinProject } from "../types/twin";
import { runLocalAddressAgent, type AgentRun } from "./agent";
import { confidenceKo, coordinateText, createUi, geocodingStatusKo, layerRows, sourceTypeKo } from "./ui";
import { TwinViewer } from "./viewer";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;
const controls = createUi(app, twin, manifest);

// UI Log Helper
function addLog(text: string, type: "info" | "success" | "warn" | "danger" = "info"): void {
  const log = document.createElement("div");
  log.className = `log-item ${type}`;
  log.innerText = text;
  controls.logFeed.appendChild(log);
  controls.logFeed.scrollTop = controls.logFeed.scrollHeight;
  while (controls.logFeed.children.length > 24) {
    controls.logFeed.removeChild(controls.logFeed.firstChild!);
  }
}

// Callbacks instance for TwinViewer
const hydrologyCallbacks = {
  onLog: (text: string, type: "info" | "success" | "warn" | "danger") => {
    addLog(text, type);
  },
  onApiStatusUpdate: (key: "geocode" | "osm" | "dem" | "tile", status: "gray" | "green" | "yellow" | "red") => {
    // API LED Indicators mapping in the HTML template
    const ledEl = document.getElementById(`led-${key}`);
    if (ledEl) {
      ledEl.className = `led-indicator led-${status}`;
    }
  },
  onStatsUpdate: (stats: {
    totalSurfaceWater: number;
    totalPipeWater: number;
    subwayWater: number;
    totalOutflowVolume: number;
    overflowCount: number;
  }) => {
    controls.surfaceWaterDisplay.textContent = `${stats.totalSurfaceWater.toFixed(1)} ㎥`;
    controls.pipeWaterDisplay.textContent = `${stats.totalPipeWater.toFixed(1)} ㎥`;
    controls.subwayWaterDisplay.textContent = `${stats.subwayWater.toFixed(1)} ㎥`;
    controls.outflowDisplay.textContent = `${stats.totalOutflowVolume.toFixed(1)} ㎥`;
    controls.overflowDisplay.textContent = String(stats.overflowCount);
    controls.overflowDisplay.className = stats.overflowCount > 0 ? "stat-value danger" : "stat-value success";
    
    // Toggle subway alarm banner visibility
    if (stats.subwayWater > 15) {
      controls.subwayAlertBanner.style.display = "flex";
    } else {
      controls.subwayAlertBanner.style.display = "none";
    }
  },
  onGaugesUpdate: (drainPercent: number, pressurePercent: number, speedMS: number) => {
    controls.gaugeDrainVal.textContent = `${drainPercent}%`;
    controls.gaugeDrainBar.style.width = `${drainPercent}%`;

    controls.gaugePressureVal.textContent = `${pressurePercent}%`;
    controls.gaugePressureBar.style.width = `${pressurePercent}%`;
    controls.gaugePressureBar.className = pressurePercent > 70 ? "gauge-bar high" : "gauge-bar";

    controls.gaugeVelocityVal.textContent = `${speedMS.toFixed(1)} m/s`;
    controls.gaugeVelocityBar.style.width = `${Math.min(100, Math.floor(speedMS * 12))}%`;
  },
  onCellInspect: (cell: any | null) => {
    if (!cell) {
      controls.inspectCellCoord.textContent = "선택된 격자 없음";
      controls.inspectType.textContent = "-";
      controls.inspectMetadata.textContent = "-";
      controls.inspectElevation.textContent = "-";
      controls.inspectWater.textContent = "-";
      controls.inspectSewer.textContent = "-";
      controls.inspectPipe.textContent = "-";
      controls.inspectPipeWater.textContent = "-";
      return;
    }

    controls.inspectCellCoord.textContent = `선택 격자 [${cell.x}, ${cell.z}]`;
    
    let gTypeName = "인도 및 완충녹지";
    let gTypeClass = "badge grass";
    let metaHTML = "일반 자연 피복 블록";

    if (cell.type === "road") {
      gTypeName = "아스팔트 포장도로";
      gTypeClass = "badge road";
      metaHTML = cell.name || "인근 도로망";
    } else if (cell.type === "building") {
      gTypeName = cell.isTarget ? "랜드마크 빌딩" : "상업 오피스 빌딩";
      gTypeClass = cell.isTarget ? "badge target" : "badge building";
      metaHTML = `${cell.name || "오피스 매스"}<br>실측높이: ${cell.buildingHeight}m`;
    }

    if (cell.isSubwayExit) {
      gTypeName = "지하철 출입구";
      gTypeClass = "badge subway-exit";
      metaHTML = `강남역 연결구 (유입 시 역사 내 지하 침수 발생)`;
    }

    controls.inspectType.innerHTML = `<span class="${gTypeClass}">${gTypeName}</span>`;
    controls.inspectMetadata.innerHTML = metaHTML;
    controls.inspectElevation.textContent = `${cell.elevation} m`;
    controls.inspectWater.textContent = cell.water > 0.005 ? `${cell.water.toFixed(3)} m` : "건조함";
    controls.inspectSewer.textContent = cell.hasSewer ? "🕳️ 우수 빗물받이 설치됨" : cell.isSubwayExit ? "🚇 지하철 통로 연결됨" : "없음";
    controls.inspectPipe.textContent = cell.hasPipe ? "⚙️ 지하 관거 연동됨" : "없음";
    controls.inspectPipeWater.textContent = cell.hasPipe ? `${(cell.pipeWater * 100 / 2.0).toFixed(0)}% (${cell.pipeWater.toFixed(2)}m)` : "N/A";
  }
};

const rawMode = import.meta.env.VITE_BASEMAP_MODE;
const basemapMode =
  rawMode === "procedural" || rawMode === "vworld" || rawMode === "arcgis" || rawMode === "custom"
    ? rawMode
    : "arcgis";

const viewer = new TwinViewer({
  host: controls.sceneHost,
  twin,
  basemapMode,
  customTileUrl: import.meta.env.VITE_CUSTOM_TILE_URL,
  callbacks: hydrologyCallbacks
});

// Real-time Rolling Hydrograph Chart Setup
const chartHistory = {
  rain: [] as number[],
  runoff: [] as number[],
  discharge: [] as number[],
  subway: [] as number[]
};

function updateHydrographData() {
  chartHistory.rain.push(viewer.hydrologyState.rainIntensity);
  chartHistory.runoff.push(viewer.hydrologyState.totalSurfaceWater);
  chartHistory.discharge.push(viewer.hydrologyState.totalOutflowVolume);
  chartHistory.subway.push(viewer.hydrologyState.subwayWater);
  
  if (chartHistory.rain.length > 60) {
    chartHistory.rain.shift();
    chartHistory.runoff.shift();
    chartHistory.discharge.shift();
    chartHistory.subway.shift();
  }
  
  drawHydrograph();
}

function drawHydrograph() {
  const canvas = controls.sceneHost.parentNode?.querySelector("#hydrograph-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  
  const rect = (canvas.parentNode as HTMLElement).getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  const w = rect.width;
  const h = rect.height;
  
  ctx.fillStyle = "#02040c";
  ctx.fillRect(0, 0, w, h);
  
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += w / 6) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += h / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  
  let maxVal = 100.0;
  for (let i = 0; i < chartHistory.rain.length; i++) {
    maxVal = Math.max(maxVal, chartHistory.rain[i]);
    maxVal = Math.max(maxVal, chartHistory.runoff[i] / 10);
    maxVal = Math.max(maxVal, chartHistory.discharge[i] / 20);
    maxVal = Math.max(maxVal, chartHistory.subway[i]);
  }
  
  const plotLine = (data: number[], color: string, scaleFactor: number, isDashed: boolean) => {
    if (data.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (isDashed) ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);
    
    ctx.beginPath();
    const spacing = w / 59;
    for (let i = 0; i < data.length; i++) {
      const px = i * spacing;
      const val = data[i] * scaleFactor;
      const py = h - 6 - ((val / maxVal) * (h - 18));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  
  plotLine(chartHistory.rain, "#5ce1e6", 1.0, true);
  plotLine(chartHistory.runoff, "#f59e0b", 0.1, false);
  plotLine(chartHistory.discharge, "#10b981", 0.05, false);
  plotLine(chartHistory.subway, "#ef4444", 1.0, false);
  
  ctx.font = "bold 8.5px sans-serif";
  ctx.fillStyle = "#5ce1e6"; ctx.fillText("우량", 6, 12);
  ctx.fillStyle = "#f59e0b"; ctx.fillText("지상우수(x0.1)", 38, 12);
  ctx.fillStyle = "#10b981"; ctx.fillText("방류구(x0.05)", 110, 12);
  ctx.fillStyle = "#ef4444"; ctx.fillText("지하철침수", 182, 12);
}

// Bind Chart Interval
setInterval(updateHydrographData, 500);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAgentRun(run: AgentRun): void {
  if (run.twin && run.manifest) {
    updateProjectUi(run.twin, run.manifest);
    void viewer.loadProject(run.twin);
  }

  controls.agentTranscript.innerHTML = run.messages
    .map(
      (message) => `
        <div class="agent-message ${message.role}">
          <b>${message.role === "user" ? "사용자" : "로컬 에이전트"}</b>
          <span>${escapeHtml(message.text)}</span>
        </div>
      `
    )
    .join("");

  const modelText = run.model
    ? `${run.model.provider} / ${run.model.name}${run.model.available ? "" : " unavailable"}`
    : "local-rule-agent / deterministic-preview-agent";
  const modelReady = run.model?.provider === "ollama" && run.model.available;
  const modelStatus = modelReady ? "LLM: Gemma 4B 연결" : "LLM 미연결: 로컬 규칙";

  controls.agentSteps.innerHTML = run.steps
    .map(
      (step) => `
        <div class="agent-step step-${step.status}">
          <b>${escapeHtml(step.label)}</b>
          <span>${escapeHtml(step.detail)}</span>
        </div>
      `
    )
    .join("") + `<div class="agent-model">모델: ${escapeHtml(modelText)}</div>`;
  controls.modelStatus.textContent = modelStatus;
  controls.modelStatus.classList.remove("pending");
  controls.modelStatus.classList.toggle("connected", modelReady);
  controls.modelStatus.classList.toggle("fallback", !modelReady);

  controls.agentOutputs.innerHTML = run.outputLinks
    .map(
      (link) => `
        <a class="output-link ${link.kind}" href="${link.href}" target="_blank" rel="noreferrer">
          ${escapeHtml(link.label)}
        </a>
      `
    )
    .join("");
}

function updateProjectUi(nextTwin: TwinProject, nextManifest: SourceManifest): void {
  controls.parcelAddress.textContent = nextTwin.addresses.parcel_address;
  controls.roadAddress.textContent = nextTwin.addresses.road_address_candidate;
  controls.buildingName.textContent = nextTwin.addresses.building_name_candidate;
  controls.coordinates.textContent = coordinateText(nextTwin);
  controls.confidence.textContent = confidenceKo(nextTwin.geocoding.confidence);
  controls.parcelBoundarySource.textContent = `${sourceTypeKo(nextTwin.parcel.source_type)} / ${confidenceKo(nextTwin.parcel.confidence)}`;
  controls.sourceStatus.textContent = geocodingStatusKo(nextManifest.geocoding.provider);
  controls.sourceStatus.className = `status-pill source-status ${nextManifest.geocoding.provider}`;
  controls.layerRows.innerHTML = layerRows(nextManifest);
  controls.inlineWarning.textContent = nextTwin.viewer.warning;
  controls.warningBanner.textContent = nextTwin.viewer.warning;
}

function setConnectionPending(): void {
  controls.sourceStatus.textContent = "공간 데이터 확인 중";
  controls.sourceStatus.className = "status-pill source-status pending";
  controls.modelStatus.textContent = "LLM 확인 중";
  controls.modelStatus.classList.remove("connected", "fallback");
  controls.modelStatus.classList.add("pending");
  controls.inlineWarning.textContent = "Juso/VWorld/WFS/Gemma 연결 상태를 확인하고 있습니다.";
  controls.warningBanner.textContent = "Juso/VWorld/WFS/Gemma 연결 상태를 확인하고 있습니다.";
}

function setLocalFallbackState(): void {
  controls.sourceStatus.textContent = "공간 데이터: 서버 응답 대기/로컬 프리뷰";
  controls.sourceStatus.className = "status-pill source-status fallback";
  controls.inlineWarning.textContent =
    "서버 연결이 지연되어 로컬 프리뷰를 표시 중입니다. 잠시 후 다시 생성하면 Juso/VWorld/WFS 결과로 갱신됩니다.";
  controls.warningBanner.textContent =
    "서버 연결이 지연되어 로컬 프리뷰를 표시 중입니다. 잠시 후 다시 생성하면 Juso/VWorld/WFS 결과로 갱신됩니다.";
}

async function runPrompt(): Promise<void> {
  setConnectionPending();
  const localResult = runLocalAddressAgent(controls.promptInput.value, twin, manifest);
  let result = localResult;
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: controls.promptInput.value,
        project_id: twin.project_id
      })
    });
    if (response.ok) {
      result = (await response.json()) as AgentRun;
    }
  } catch {
    result = localResult;
  }

  renderAgentRun(result);
  if (!result.twin || !result.manifest) {
    setLocalFallbackState();
  }
  viewer.setOrbitView();
  setActive(controls.orbitButton, true);
  setActive(controls.topButton, false);
  syncSatelliteVisibility();
}

function setActive(button: HTMLButtonElement, active: boolean): void {
  button.classList.toggle("active", active);
}

function syncSatelliteVisibility(): void {
  if (basemapMode !== "procedural" && controls.satelliteButton.classList.contains("active")) {
    viewer.setSatelliteVisible(true);
  }
}

controls.satelliteButton.disabled = basemapMode === "procedural";
controls.satelliteButton.title =
  basemapMode === "procedural"
    ? "VITE_BASEMAP_MODE=vworld, arcgis 또는 custom 설정 시 활성화"
    : "클릭 시 위성 타일을 실시간으로 켜고 끕니다";

if (basemapMode !== "procedural") {
  setActive(controls.satelliteButton, true);
}

controls.orbitButton.addEventListener("click", () => {
  viewer.setOrbitView();
  setActive(controls.orbitButton, true);
  setActive(controls.topButton, false);
});

controls.topButton.addEventListener("click", () => {
  viewer.setTopView();
  setActive(controls.topButton, true);
  setActive(controls.orbitButton, false);
});

controls.satelliteButton.addEventListener("click", () => {
  const active = !controls.satelliteButton.classList.contains("active");
  viewer.setSatelliteVisible(active);
  setActive(controls.satelliteButton, active);
});

controls.massButton.addEventListener("click", () => {
  const active = !controls.massButton.classList.contains("active");
  viewer.setMassVisible(active);
  setActive(controls.massButton, active);
});

controls.xrayButton.addEventListener("click", () => {
  const active = !controls.xrayButton.classList.contains("active");
  viewer.setXray(active);
  setActive(controls.xrayButton, active);
});

controls.shadowButton.addEventListener("click", () => {
  const active = !controls.shadowButton.classList.contains("active");
  viewer.setShadow(active);
  setActive(controls.shadowButton, active);
});

function updateOffset(): void {
  const x = Number(controls.offsetX.value);
  const z = Number(controls.offsetZ.value);
  viewer.setTargetOffset(x, z);
  controls.offsetXValue.textContent = `${x.toFixed(1)}m`;
  controls.offsetZValue.textContent = `${z.toFixed(1)}m`;
}

controls.offsetX.addEventListener("input", updateOffset);
controls.offsetZ.addEventListener("input", updateOffset);
controls.runButton.addEventListener("click", runPrompt);
controls.promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    void runPrompt();
  }
});

// ==========================================
// SIMULATOR BINDINGS (ADDITIONS)
// ==========================================

// Rain intensity slider
controls.rainSlider.addEventListener("input", (e) => {
  const val = parseInt((e.target as HTMLInputElement).value);
  viewer.hydrologyState.rainIntensity = val;

  let label = "맑음 (0mm/h)";
  if (val > 120) label = `🚨 극한 폭우 (${val}mm/h)`;
  else if (val > 60) label = `🌧️ 집중호우 (${val}mm/h)`;
  else if (val > 0) label = `🌦️ 약한 강우 (${val}mm/h)`;
  controls.rainLabel.textContent = label;
});

// Scenario preset buttons
const scenBtns = [
  { btn: controls.scenNormal, name: "normal" },
  { btn: controls.scen2022, name: "2022" },
  { btn: controls.scenExpand, name: "expand" },
  { btn: controls.scenTunnel, name: "tunnel" }
];

scenBtns.forEach(({ btn, name }) => {
  btn.addEventListener("click", () => {
    viewer.loadScenario(name as any);
    scenBtns.forEach(b => b.btn.classList.remove("active"));
    btn.classList.add("active");

    // Sync rain slider position matching scenario
    controls.rainSlider.value = String(viewer.hydrologyState.rainIntensity);
    let label = "맑음 (0mm/h)";
    const val = viewer.hydrologyState.rainIntensity;
    if (val > 120) label = `🚨 극한 폭우 (${val}mm/h)`;
    else if (val > 60) label = `🌧️ 집중호우 (${val}mm/h)`;
    else if (val > 0) label = `🌦️ 약한 강우 (${val}mm/h)`;
    controls.rainLabel.textContent = label;
  });
});

// Dry Grid
controls.btnDryGrid.addEventListener("click", () => {
  viewer.dryUpGrid();
});

// Theme Toggle
controls.themeToggleBtn.addEventListener("click", () => {
  const theme = viewer.hydrologyState.theme === "light" ? "dark" : "light";
  viewer.applyTheme(theme);
  controls.themeToggleBtn.textContent = theme === "light" ? "☀️ 주간 뷰" : "🌙 야간 뷰";
  document.body.classList.toggle("light-theme", theme === "light");
});

// Editor Edit Toolbar tools
const editTools = [
  { btn: controls.toolInspect, tool: "inspect" },
  { btn: controls.toolRoad, tool: "road" },
  { btn: controls.toolBuilding, tool: "building" },
  { btn: controls.toolSewer, tool: "sewer" },
  { btn: controls.toolPipe, tool: "pipe" },
  { btn: controls.toolOutfall, tool: "outfall" },
  { btn: controls.toolRaise, tool: "raise" },
  { btn: controls.toolLower, tool: "lower" },
  { btn: controls.toolEraser, tool: "eraser" }
];

editTools.forEach(({ btn, tool }) => {
  btn.addEventListener("click", () => {
    viewer.hydrologyState.selectedTool = tool;
    editTools.forEach(t => t.btn.classList.remove("active"));
    btn.classList.add("active");
  });
});

const queryFromUrl = new URLSearchParams(window.location.search).get("q");
if (queryFromUrl) {
  controls.promptInput.value = queryFromUrl;
}
updateOffset();
void runPrompt();

window.addEventListener("beforeunload", () => viewer.dispose());
