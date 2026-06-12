import sadangTwin from "../samples/sadang_317_6/twin.json";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import { generateQaReport } from "../core/qa";
import { escapeHtml } from "../lib/html";
import { BASEMAP_ATTRIBUTION, resolveBasemapMode } from "../render/basemap";
import { SoundSynth } from "../render/sound";
import { CityViewer, WebGLUnavailableError } from "../scene/viewer";
import type { SourceManifest, TwinProject } from "../types/twin";
import { runLocalAddressAgent, type AgentRun } from "./agent";
import {
  coordinateText,
  confidenceKo,
  createUi,
  dataReadinessSummary,
  floodRiskSummary,
  geocodingStatusKo,
  layerRows,
  rainLabelText,
  scenarioNarrativeText
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
let blobUrls: string[] = [];
let capacityMultiplier = 1;
let scenarioDrainScale = 1;
let backflowActive = false;
let lastBackflowLogged = false;

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

// ---------------------------------------------------------------- viewer (WebGL-guarded)

let viewer: CityViewer | null = null;
try {
  viewer = new CityViewer(controls.sceneHost, {
    onPick: (pick) => {
      if (!pick) {
        controls.inspectTitle.textContent = "씬을 클릭해 지점을 검사하세요";
        return;
      }
      sound.playClick();
      controls.inspectTitle.textContent = `지점 (${pick.worldX.toFixed(0)}, ${pick.worldZ.toFixed(0)})m`;
      controls.inspectGround.textContent = `${pick.groundM.toFixed(1)} m`;
      controls.inspectDepth.textContent = pick.depthM > 0.02 ? `${pick.depthM.toFixed(2)} m` : "건조함";
      controls.inspectBuilding.textContent = pick.building
        ? `${pick.building.name || "건물"} · ${pick.building.heightM.toFixed(0)}m${pick.building.floors ? ` · ${pick.building.floors}층` : ""} (${pick.building.sourceType})`
        : "-";
    }
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
    makeBlobLink("source_manifest.json", "manifest", JSON.stringify(manifest, null, 2), "application/json", `${twin.project_id}_manifest.json`),
    makeBlobLink("qa_report.html", "qa", generateQaReport(twin, manifest), "text/html", `${twin.project_id}_qa.html`)
  ].join("");
}

// ---------------------------------------------------------------- project loading

function updateProjectUi(): void {
  const readiness = dataReadinessSummary(manifest);
  controls.parcelAddress.textContent = twin.addresses.parcel_address;
  controls.roadAddress.textContent = twin.addresses.road_address_candidate;
  controls.buildingName.textContent = twin.addresses.building_name_candidate;
  controls.coordinates.textContent = coordinateText(twin);
  controls.confidence.textContent = confidenceKo(twin.geocoding.confidence);
  controls.stageAddress.textContent = twin.addresses.parcel_address;
  controls.readinessPill.textContent = `${readiness.label} · ${readiness.score}`;
  controls.readinessPill.className = `readiness-pill ${readiness.tone}`;
  controls.readinessDetail.textContent = readiness.detail;
  controls.sourceStatus.textContent = geocodingStatusKo(manifest.geocoding.provider);
  controls.sourceStatus.className = `status-pill ${manifest.geocoding.provider}`;
  controls.layerRows.innerHTML = layerRows(manifest);
  controls.warningBanner.textContent = twin.viewer.warning;
}

async function loadProject(nextTwin: TwinProject, nextManifest: SourceManifest): Promise<void> {
  twin = nextTwin;
  manifest = nextManifest;
  applyScenario("clear");
  updateProjectUi();
  rebuildArtifactLinks();
  const officialCount = twin.buildings.filter((b) => b.source_type === "official").length;
  addLog(
    `트윈 로드: ${twin.addresses.parcel_address} — 건물 ${twin.buildings.length}동 (공식 ${officialCount}) · 도로 ${twin.roads.length}본`,
    "success"
  );
  if (viewer) {
    controls.warningBanner.textContent = "실지형(DEM)·위성·건물 데이터를 불러오는 중…";
    await viewer.loadProject(twin, basemapMode, import.meta.env.VITE_CUSTOM_TILE_URL);
    controls.warningBanner.textContent = twin.viewer.warning;
    addLog(`수문 격자 베이크 완료 — 빗물받이 ${viewer.baked?.drains.length ?? 0}개, 관거 용량 ${(viewer.baked?.networkCapacityM3 ?? 0).toFixed(0)}㎥`, "info");
  }
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
    void loadProject(run.twin, run.manifest);
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

// ---------------------------------------------------------------- scenarios

function syncScenarioButtons(id: string): void {
  for (const button of controls.scenarioButtons) {
    button.classList.toggle("active", button.dataset.scenario === id);
  }
}

function setRain(mmPerHour: number): void {
  viewer?.setRain(mmPerHour);
  controls.rainSlider.value = String(mmPerHour);
  controls.rainLabel.textContent = rainLabelText(mmPerHour);
}

function applyScenario(id: string): void {
  syncScenarioButtons(id);
  capacityMultiplier = 1;
  scenarioDrainScale = 1;
  backflowActive = false;
  lastBackflowLogged = false;
  if (viewer?.solver) {
    viewer.solver.drainScale = 1;
    viewer.solver.backflowMps = 0;
  }
  viewer?.setBackflowVisual(false);

  if (id === "clear") {
    setRain(0);
    viewer?.solver?.reset();
  } else if (id === "heavy") {
    setRain(80);
    sound.playThunder();
  } else if (id === "cloudburst") {
    setRain(140);
    sound.playThunder();
  } else if (id === "tunnel") {
    capacityMultiplier = 6;
    scenarioDrainScale = 1.4;
    if (viewer?.solver) viewer.solver.drainScale = scenarioDrainScale;
    setRain(Math.max(140, Number(controls.rainSlider.value)));
  }
  controls.scenarioNarrative.textContent = scenarioNarrativeText(id, Number(controls.rainSlider.value));
}

// ---------------------------------------------------------------- stats loop

const chartHistory = { rain: [] as number[], volume: [] as number[], flooded: [] as number[], absorbed: [] as number[] };

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

  context.fillStyle = "#02040c";
  context.fillRect(0, 0, width, height);

  let maxValue = 150;
  for (let i = 0; i < chartHistory.rain.length; i++) {
    maxValue = Math.max(
      maxValue,
      chartHistory.rain[i],
      chartHistory.volume[i] / 50,
      chartHistory.flooded[i] / 400,
      chartHistory.absorbed[i] / 10
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
  plot(chartHistory.volume, "#f59e0b", 1 / 50, false);
  plot(chartHistory.flooded, "#a78bfa", 1 / 400, false);
  plot(chartHistory.absorbed, "#10b981", 1 / 10, false);

  context.setLineDash([]);
  context.font = "bold 8.5px sans-serif";
  context.fillStyle = "#5ce1e6";
  context.fillText("우량", 6, 12);
  context.fillStyle = "#f59e0b";
  context.fillText("지표수(/50)", 34, 12);
  context.fillStyle = "#a78bfa";
  context.fillText("침수면적(/400)", 96, 12);
  context.fillStyle = "#10b981";
  context.fillText("관거흡수(/10)", 172, 12);
}

window.setInterval(() => {
  if (!viewer?.solver || !viewer.baked) return;
  const stats = viewer.readStats();
  if (!stats) return;

  const capacity = viewer.baked.networkCapacityM3 * capacityMultiplier;
  const load = Math.min(1.5, stats.absorbedM3 / capacity);
  const nowBackflow = stats.absorbedM3 >= capacity;
  if (nowBackflow !== backflowActive) {
    backflowActive = nowBackflow;
    viewer.solver.drainScale = nowBackflow ? 0 : scenarioDrainScale;
    viewer.solver.backflowMps = nowBackflow ? 0.014 : 0;
    viewer.setBackflowVisual(nowBackflow);
    if (nowBackflow && !lastBackflowLogged) {
      lastBackflowLogged = true;
      sound.playOverflow();
      addLog("🚨 하수 관거 포화 — 맨홀 역류 시작!", "danger");
    }
  }

  controls.statVolume.textContent = `${stats.volumeM3.toFixed(0)} ㎥`;
  controls.statFlooded.textContent = `${stats.floodedAreaM2.toFixed(0)} ㎡`;
  controls.statMaxDepth.textContent = `${stats.maxDepthM.toFixed(2)} m`;
  controls.statNetwork.textContent = `${Math.round(load * 100)}%`;
  controls.statNetwork.className = load > 0.95 ? "danger" : "";
  controls.statBackflow.textContent = backflowActive ? "역류 중" : "정상";
  controls.statBackflow.className = backflowActive ? "danger" : "";
  controls.gaugeNetworkValue.textContent = `${Math.round(load * 100)}%`;
  controls.gaugeNetworkBar.style.width = `${Math.min(100, load * 100)}%`;
  controls.gaugeNetworkBar.className = load > 0.95 ? "gauge-bar high" : "gauge-bar";

  const risk = floodRiskSummary(
    {
      floodedAreaM2: stats.floodedAreaM2,
      maxDepthM: stats.maxDepthM,
      volumeM3: stats.volumeM3
    },
    load,
    backflowActive
  );
  controls.riskCard.className = `risk-card ${risk.level}`;
  controls.riskLevel.textContent = risk.label;
  controls.riskReason.textContent = risk.detail;
  controls.riskBar.style.width = `${risk.percent}%`;

  const flooding = stats.floodedAreaM2 > 1500 && backflowActive;
  controls.floodAlert.hidden = !flooding;

  chartHistory.rain.push(viewer.solver.rainMmPerHour);
  chartHistory.volume.push(stats.volumeM3);
  chartHistory.flooded.push(stats.floodedAreaM2);
  chartHistory.absorbed.push(stats.absorbedM3);
  for (const series of Object.values(chartHistory)) {
    if (series.length > 60) series.shift();
  }
  drawHydrograph();
}, 500);

// ---------------------------------------------------------------- bindings

controls.orbitButton.addEventListener("click", () => {
  viewer?.setView("orbit");
  controls.orbitButton.classList.add("active");
  controls.topButton.classList.remove("active");
});
controls.topButton.addEventListener("click", () => {
  viewer?.setView("top");
  controls.topButton.classList.add("active");
  controls.orbitButton.classList.remove("active");
});
controls.buildingsButton.addEventListener("click", () => {
  const active = !controls.buildingsButton.classList.contains("active");
  viewer?.setBuildingsVisible(active);
  controls.buildingsButton.classList.toggle("active", active);
});
controls.shadowButton.addEventListener("click", () => {
  const active = !controls.shadowButton.classList.contains("active");
  viewer?.setShadow(active);
  controls.shadowButton.classList.toggle("active", active);
});

controls.rainSlider.addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  viewer?.setRain(value);
  controls.rainLabel.textContent = rainLabelText(value);
  controls.scenarioNarrative.textContent = scenarioNarrativeText("manual", value);
});

for (const button of controls.scenarioButtons) {
  button.addEventListener("click", () => {
    applyScenario(button.dataset.scenario ?? "clear");
    addLog(`시나리오 적용: ${button.textContent}`, "info");
  });
}

controls.dryButton.addEventListener("click", () => {
  viewer?.solver?.reset();
  backflowActive = false;
  lastBackflowLogged = false;
  if (viewer?.solver) {
    viewer.solver.drainScale = scenarioDrainScale;
    viewer.solver.backflowMps = 0;
  }
  viewer?.setBackflowVisual(false);
  addLog("지표 건조 완료.", "info");
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

viewer?.start(() => {});
// dev console handle (harmless in prod; enables headless debugging too)
(window as unknown as { __twin?: object }).__twin = { viewer };

const queryFromUrl = new URLSearchParams(window.location.search).get("q");
controls.promptInput.value = queryFromUrl ?? "사당동 317-6번지 디지털 트윈 만들어줘";
renderAgentRun(runLocalAddressAgent(controls.promptInput.value, initialTwin, initialManifest));

window.addEventListener("beforeunload", () => viewer?.dispose());
