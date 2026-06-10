import sadangTwin from "../samples/sadang_317_6/twin.json";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import { generateQaReport } from "../core/qa";
import { escapeHtml } from "../lib/html";
import { BASEMAP_ATTRIBUTION, resolveBasemapMode } from "../render/basemap";
import { SceneRenderer, WebGLUnavailableError } from "../render/scene";
import { SoundSynth } from "../render/sound";
import {
  UNDERGROUND_ALARM_M3,
  applyScenario,
  applyTool,
  createSimFromTwin,
  dryUp,
  stepSim,
  type SimCell,
  type SimScenario,
  type SimState,
  type SimTool
} from "../sim/hydrology";
import type { SourceManifest, TwinProject } from "../types/twin";
import { runLocalAddressAgent, type AgentRun } from "./agent";
import {
  coordinateText,
  confidenceKo,
  createUi,
  geocodingStatusKo,
  layerRows,
  rainLabelText,
  sourceTypeKo
} from "./ui";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

const initialTwin = sadangTwin as unknown as TwinProject;
const initialManifest = sadangManifest as unknown as SourceManifest;
const controls = createUi(app, initialTwin, initialManifest);

const basemapMode = resolveBasemapMode(
  import.meta.env.VITE_BASEMAP_MODE,
  import.meta.env.VITE_CUSTOM_TILE_URL
);
controls.basemapAttribution.textContent = BASEMAP_ATTRIBUTION[basemapMode];

const sound = new SoundSynth();

// ---------------------------------------------------------------- state

let twin: TwinProject = initialTwin;
let manifest: SourceManifest = initialManifest;
let sim: SimState = createSimFromTwin(twin);
let selectedTool: SimTool = "inspect";
let theme: "light" | "dark" = "dark";
let undergroundAlarmed = false;
let lastOverflowCount = 0;
let blobUrls: string[] = [];

// ---------------------------------------------------------------- logging

function addLog(text: string, type: "info" | "success" | "warn" | "danger" = "info"): void {
  const entry = document.createElement("div");
  entry.className = `log-item ${type}`;
  entry.innerText = text;
  controls.logFeed.appendChild(entry);
  controls.logFeed.scrollTop = controls.logFeed.scrollHeight;
  while (controls.logFeed.children.length > 24) {
    controls.logFeed.removeChild(controls.logFeed.firstChild!);
  }
}

// ---------------------------------------------------------------- renderer (WebGL-guarded)

let renderer: SceneRenderer | null = null;
try {
  renderer = new SceneRenderer(controls.sceneHost, {
    onCellPick: (cell) => handleCellPick(cell)
  });
} catch (error) {
  if (error instanceof WebGLUnavailableError) {
    controls.webglFallback.hidden = false;
    controls.warningBanner.textContent =
      "WebGL 미지원 환경: 3D 미리보기 없이 주소 분석과 산출물 생성만 동작합니다.";
    addLog("WebGL 컨텍스트 생성 실패 — 3D 없이 콘솔 모드로 동작합니다.", "danger");
  } else {
    throw error;
  }
}

// ---------------------------------------------------------------- artifacts

function rebuildArtifactLinks(): void {
  for (const url of blobUrls) URL.revokeObjectURL(url);
  blobUrls = [];

  const makeBlobLink = (label: string, kind: string, content: string, mime: string, filename: string): string => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    blobUrls.push(url);
    return `<a class="output-link ${kind}" href="${url}" download="${filename}">${escapeHtml(label)}</a>`;
  };

  controls.agentOutputs.innerHTML = [
    makeBlobLink("twin.json", "data", JSON.stringify(twin, null, 2), "application/json", `${twin.project_id}_twin.json`),
    makeBlobLink(
      "source_manifest.json",
      "manifest",
      JSON.stringify(manifest, null, 2),
      "application/json",
      `${twin.project_id}_manifest.json`
    ),
    makeBlobLink("qa_report.html", "qa", generateQaReport(twin, manifest), "text/html", `${twin.project_id}_qa.html`)
  ].join("");
}

// ---------------------------------------------------------------- project loading

function updateProjectUi(): void {
  controls.parcelAddress.textContent = twin.addresses.parcel_address;
  controls.roadAddress.textContent = twin.addresses.road_address_candidate;
  controls.buildingName.textContent = twin.addresses.building_name_candidate;
  controls.coordinates.textContent = coordinateText(twin);
  controls.confidence.textContent = confidenceKo(twin.geocoding.confidence);
  controls.parcelBoundarySource.textContent = `${sourceTypeKo(twin.parcel.source_type)} / ${confidenceKo(twin.parcel.confidence)}`;
  controls.sourceStatus.textContent = geocodingStatusKo(manifest.geocoding.provider);
  controls.sourceStatus.className = `status-pill ${manifest.geocoding.provider}`;
  controls.layerRows.innerHTML = layerRows(manifest);
  controls.warningBanner.textContent = twin.viewer.warning;
}

function loadProject(nextTwin: TwinProject, nextManifest: SourceManifest): void {
  twin = nextTwin;
  manifest = nextManifest;
  sim = createSimFromTwin(twin);
  undergroundAlarmed = false;
  lastOverflowCount = 0;
  controls.undergroundAlert.hidden = true;
  syncScenarioButtons("normal");
  controls.rainSlider.value = "0";
  controls.rainLabel.textContent = rainLabelText(0);
  updateProjectUi();
  rebuildArtifactLinks();
  void renderer?.loadProject(twin, sim, basemapMode, import.meta.env.VITE_CUSTOM_TILE_URL);
  addLog(`트윈 로드: ${twin.project_id} (${twin.addresses.parcel_address})`, "success");
}

// ---------------------------------------------------------------- agent console

function renderAgentRun(run: AgentRun): void {
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

  controls.agentSteps.innerHTML =
    run.steps
      .map(
        (step) => `
          <div class="agent-step step-${step.status}">
            <b>${escapeHtml(step.label)}</b>
            <span>${escapeHtml(step.detail)}</span>
          </div>
        `
      )
      .join("") + `<div class="agent-model">모델: ${escapeHtml(modelText)}</div>`;

  controls.modelStatus.textContent = modelReady ? "LLM: Gemma 연결" : "LLM 미연결: 로컬 규칙";
  controls.modelStatus.classList.remove("pending");
  controls.modelStatus.classList.toggle("connected", modelReady);
  controls.modelStatus.classList.toggle("fallback", !modelReady);

  if (run.twin && run.manifest) {
    loadProject(run.twin, run.manifest);
  }
  // Server runs may carry their own artifact links; otherwise blob links were rebuilt above.
  if (run.outputLinks.length > 0) {
    controls.agentOutputs.innerHTML = run.outputLinks
      .map(
        (link) =>
          `<a class="output-link ${link.kind}" href="${link.href}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`
      )
      .join("");
  }
}

async function runPrompt(): Promise<void> {
  controls.sourceStatus.textContent = "공간 데이터 확인 중";
  controls.sourceStatus.className = "status-pill pending";

  const localRun = runLocalAddressAgent(controls.promptInput.value, initialTwin, initialManifest);
  let run = localRun;
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: controls.promptInput.value, project_id: twin.project_id })
    });
    if (response.ok) {
      const serverRun = (await response.json()) as AgentRun;
      if (serverRun.twin && serverRun.manifest) run = serverRun;
    }
  } catch {
    run = localRun; // dev/offline: deterministic local agent
  }
  renderAgentRun(run);
}

// ---------------------------------------------------------------- inspector / tools

function describeInfra(cell: SimCell): string {
  const parts: string[] = [];
  if (cell.hasSewer) parts.push("🕳️ 빗물받이");
  if (cell.hasPipe) parts.push("⚙️ 관거");
  if (cell.hasOutfall) parts.push("🌊 방류구");
  if (cell.isUndergroundEntrance) parts.push("🚇 지하공간 입구");
  return parts.length > 0 ? parts.join(" · ") : "없음";
}

function showCell(cell: SimCell): void {
  controls.inspectCoord.textContent = `선택 격자 [${cell.x}, ${cell.z}]`;
  const typeLabel =
    cell.type === "building"
      ? cell.isTarget
        ? `<span class="badge target">대상 건물</span>`
        : `<span class="badge building">주변 건물</span>`
      : cell.type === "road"
        ? `<span class="badge road">도로</span>`
        : `<span class="badge grass">녹지/공지</span>`;
  controls.inspectType.innerHTML = typeLabel;
  controls.inspectMeta.textContent =
    cell.type === "building" ? `${cell.name || "건물"} · 높이 ${cell.buildingHeight.toFixed(0)}m` : cell.name || "-";
  controls.inspectElevation.textContent = `${cell.elevation.toFixed(2)} m`;
  controls.inspectWater.textContent = cell.water > 0.005 ? `${cell.water.toFixed(3)} m` : "건조함";
  controls.inspectInfra.textContent = describeInfra(cell);
  controls.inspectPipeWater.textContent = cell.hasPipe
    ? `${((cell.pipeWater / sim.pipeCapacity) * 100).toFixed(0)}% (${cell.pipeWater.toFixed(2)}m)`
    : "N/A";
}

function handleCellPick(cell: SimCell | null): void {
  if (!cell) {
    controls.inspectCoord.textContent = "선택된 격자 없음";
    return;
  }
  if (selectedTool === "inspect") {
    sound.playClick();
    showCell(cell);
    return;
  }
  const changed = applyTool(sim, cell.x, cell.z, selectedTool);
  if (!changed) {
    addLog("이 격자에는 해당 도구를 적용할 수 없습니다.", "warn");
    return;
  }
  sound.playDraw();
  renderer?.refreshCellInstance(cell.x, cell.z);
  renderer?.buildInfraMarkers();
  showCell(changed);
}

// ---------------------------------------------------------------- hydrograph

const chartHistory = { rain: [] as number[], runoff: [] as number[], discharge: [] as number[], underground: [] as number[] };

function drawHydrograph(): void {
  const canvas = controls.chartCanvas;
  const context = canvas.getContext("2d");
  const parent = canvas.parentElement;
  if (!context || !parent) return;
  const rect = parent.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  context.scale(window.devicePixelRatio, window.devicePixelRatio);
  const width = rect.width;
  const height = rect.height;

  context.fillStyle = theme === "light" ? "#e8eef5" : "#02040c";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
  for (let x = 0; x < width; x += width / 6) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  let maxValue = 100;
  for (let i = 0; i < chartHistory.rain.length; i++) {
    maxValue = Math.max(
      maxValue,
      chartHistory.rain[i],
      chartHistory.runoff[i] / 10,
      chartHistory.discharge[i] / 20,
      chartHistory.underground[i]
    );
  }

  const plot = (data: number[], color: string, scale: number, dashed: boolean) => {
    if (data.length < 2) return;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash(dashed ? [4, 4] : []);
    context.beginPath();
    const spacing = width / 59;
    data.forEach((value, index) => {
      const px = index * spacing;
      const py = height - 6 - ((value * scale) / maxValue) * (height - 18);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
  };

  plot(chartHistory.rain, "#5ce1e6", 1, true);
  plot(chartHistory.runoff, "#f59e0b", 0.1, false);
  plot(chartHistory.discharge, "#10b981", 0.05, false);
  plot(chartHistory.underground, "#ef4444", 1, false);

  context.setLineDash([]);
  context.font = "bold 8.5px sans-serif";
  context.fillStyle = "#5ce1e6";
  context.fillText("우량", 6, 12);
  context.fillStyle = "#f59e0b";
  context.fillText("지표수(x0.1)", 36, 12);
  context.fillStyle = "#10b981";
  context.fillText("방류(x0.05)", 102, 12);
  context.fillStyle = "#ef4444";
  context.fillText("지하침수", 162, 12);
}

window.setInterval(() => {
  chartHistory.rain.push(sim.rainIntensity);
  chartHistory.runoff.push(sim.stats.surfaceWaterM3);
  chartHistory.discharge.push(sim.stats.outflowM3);
  chartHistory.underground.push(sim.stats.undergroundWaterM3);
  for (const series of Object.values(chartHistory)) {
    if (series.length > 60) series.shift();
  }
  drawHydrograph();
}, 500);

// ---------------------------------------------------------------- stats HUD

let statsAccumulator = 0;

function updateStatsUi(): void {
  const stats = sim.stats;
  controls.statSurface.textContent = `${stats.surfaceWaterM3.toFixed(1)} ㎥`;
  controls.statPipe.textContent = `${stats.pipeWaterM3.toFixed(1)} ㎥`;
  controls.statUnderground.textContent = `${stats.undergroundWaterM3.toFixed(1)} ㎥`;
  controls.statOutflow.textContent = `${stats.outflowM3.toFixed(1)} ㎥`;
  controls.statOverflow.textContent = String(stats.overflowCount);
  controls.statOverflow.className = stats.overflowCount > 0 ? "danger" : "";

  controls.gaugeDrainValue.textContent = `${stats.drainEfficiencyPct}%`;
  controls.gaugeDrainBar.style.width = `${stats.drainEfficiencyPct}%`;
  controls.gaugePressureValue.textContent = `${stats.pipePressurePct}%`;
  controls.gaugePressureBar.style.width = `${stats.pipePressurePct}%`;
  controls.gaugePressureBar.className = stats.pipePressurePct > 70 ? "gauge-bar high" : "gauge-bar";
  controls.gaugeVelocityValue.textContent = `${stats.dischargeSpeedMs.toFixed(1)} m/s`;
  controls.gaugeVelocityBar.style.width = `${Math.min(100, Math.floor(stats.dischargeSpeedMs * 12))}%`;

  const alarm = stats.undergroundWaterM3 > UNDERGROUND_ALARM_M3;
  controls.undergroundAlert.hidden = !alarm;
  if (alarm && !undergroundAlarmed) {
    undergroundAlarmed = true;
    sound.playWarning();
    addLog("🚨 지하공간 우수 유입 감지! 지하 침수가 진행 중입니다.", "danger");
  }
  if (!alarm) undergroundAlarmed = false;

  if (stats.overflowCount > lastOverflowCount) {
    sound.playOverflow();
    addLog(`맨홀 역류 발생: ${stats.overflowCount}개 지점`, "warn");
  }
  lastOverflowCount = stats.overflowCount;
}

function tick(dtMs: number): void {
  stepSim(sim, dtMs);
  statsAccumulator += dtMs;
  if (statsAccumulator >= 150) {
    statsAccumulator = 0;
    updateStatsUi();
  }
}

if (renderer) {
  renderer.start(tick);
} else {
  window.setInterval(() => tick(150), 150); // headless fallback: keep stats alive without 3D
}

// ---------------------------------------------------------------- bindings

function setActive(button: HTMLButtonElement, active: boolean): void {
  button.classList.toggle("active", active);
}

controls.orbitButton.addEventListener("click", () => {
  renderer?.setView("orbit");
  setActive(controls.orbitButton, true);
  setActive(controls.topButton, false);
});
controls.topButton.addEventListener("click", () => {
  renderer?.setView("top");
  setActive(controls.topButton, true);
  setActive(controls.orbitButton, false);
});

controls.satelliteButton.disabled = basemapMode === "procedural";
controls.satelliteButton.title =
  basemapMode === "procedural"
    ? "VITE_BASEMAP_MODE=vworld, arcgis 또는 custom 설정 시 활성화"
    : "위성 타일 드레이프를 켜고 끕니다";
if (basemapMode !== "procedural") {
  setActive(controls.satelliteButton, true);
  renderer?.setSatelliteVisible(true);
}
controls.satelliteButton.addEventListener("click", () => {
  const active = !controls.satelliteButton.classList.contains("active");
  renderer?.setSatelliteVisible(active);
  setActive(controls.satelliteButton, active);
});

controls.massButton.addEventListener("click", () => {
  const active = !controls.massButton.classList.contains("active");
  renderer?.setMassingVisible(active);
  setActive(controls.massButton, active);
});
controls.xrayButton.addEventListener("click", () => {
  const active = !controls.xrayButton.classList.contains("active");
  renderer?.setXray(active);
  setActive(controls.xrayButton, active);
});
controls.shadowButton.addEventListener("click", () => {
  const active = !controls.shadowButton.classList.contains("active");
  renderer?.setShadow(active);
  setActive(controls.shadowButton, active);
});

controls.rainSlider.addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  sim.rainIntensity = value;
  controls.rainLabel.textContent = rainLabelText(value);
});

function syncScenarioButtons(scenario: SimScenario): void {
  for (const button of controls.scenarioButtons) {
    setActive(button, button.dataset.scenario === scenario);
  }
}

for (const button of controls.scenarioButtons) {
  button.addEventListener("click", () => {
    const scenario = button.dataset.scenario as SimScenario;
    applyScenario(sim, scenario);
    syncScenarioButtons(scenario);
    controls.rainSlider.value = String(sim.rainIntensity);
    controls.rainLabel.textContent = rainLabelText(sim.rainIntensity);
    renderer?.buildInfraMarkers();
    if (scenario === "cloudburst") sound.playThunder();
    addLog(`시나리오 적용: ${button.textContent}`, "info");
  });
}

controls.dryButton.addEventListener("click", () => {
  dryUp(sim);
  updateStatsUi();
  addLog("지표 건조 완료.", "info");
});

for (const button of controls.toolButtons) {
  button.addEventListener("click", () => {
    selectedTool = (button.dataset.tool ?? "inspect") as SimTool;
    for (const other of controls.toolButtons) setActive(other, other === button);
  });
}

controls.themeToggle.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  renderer?.applyTheme(theme);
  document.body.classList.toggle("light-theme", theme === "light");
  controls.themeToggle.textContent = theme === "light" ? "☀️ 주간 뷰" : "🌙 야간 뷰";
});

let soundEnabled = true;
controls.soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  sound.setEnabled(soundEnabled);
  controls.soundToggle.textContent = soundEnabled ? "🔊 사운드 켜짐" : "🔇 사운드 꺼짐";
});

controls.runButton.addEventListener("click", () => void runPrompt());
controls.promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runPrompt();
});

// ---------------------------------------------------------------- boot

const queryFromUrl = new URLSearchParams(window.location.search).get("q");
controls.promptInput.value = queryFromUrl ?? "사당동 317-6번지 디지털 트윈 만들어줘";
void runPrompt();

window.addEventListener("beforeunload", () => renderer?.dispose());
