import ovstreamBrowserFrameUrl from "../../docs/evidence/nvidia-train1-ovstream-browser-first-frame-2026-06-12.png";
import ovrtxFirstFrameUrl from "../../docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png";
import warpFloodDepthUrl from "../../docs/evidence/nvidia-train1-warp-flood-depth-2026-06-13.png";
import acceptanceReport from "../../docs/evidence/nvidia-only-acceptance-sadang-2026-06-13.json";
import contentAgentsRun from "../samples/sadang_317_6/omniverse/content_agents_run/content-agents-rest-client.json";
import materialSidecar from "../samples/sadang_317_6/omniverse/content_agents_run/material/materialized.json";
import physicsSidecar from "../samples/sadang_317_6/omniverse/content_agents_run/physics/physics.json";
import stackManifest from "../samples/sadang_317_6/omniverse/nvidia_stack_manifest.json";
import { escapeHtml } from "../lib/html";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function findNamed(items: unknown[], name: string): JsonObject {
  return object(items.find((item) => text(object(item).name, "") === name));
}

function nested(source: JsonObject, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) current = object(current)[key];
  return current;
}

function gateEvidence(gates: unknown[], id: string): string {
  const gate = object(gates.find((item) => text(object(item).id, "") === id));
  return text(gate.evidence, "no evidence");
}

export interface NvidiaVisualArtifact {
  id: "fused" | "ovrtx" | "ovstream" | "warp";
  title: string;
  product: string;
  status: string;
  imageUrl: string;
  sourcePath: string;
  caption: string;
  evidence: string;
  warpOverlayUrl?: string;
  fused?: boolean;
}

export interface NvidiaEvidenceSummary {
  acceptanceStatus: string;
  passedGateCount: number;
  totalGateCount: number;
  stageMeshCount: number;
  stageCollisionMeshCount: number;
  stageOpenUsd: string;
  ovrtxStage: string;
  materialSessionId: string;
  materialRenderedImages: number;
  materialPredictions: number;
  materialAppliedCount: number;
  physicsSessionId: string;
  physicsRenderedImages: number;
  physicsIdentification: string;
  simReadyStage: string;
  warpEvidence: string;
  ovstreamEvidence: string;
  browserEvidence: string;
  workflow: string;
  caveat: string;
}

export function getNvidiaVisualArtifacts(): NvidiaVisualArtifact[] {
  const acceptance = object(acceptanceReport);
  const gates = array(acceptance.gates);
  return [
    {
      id: "fused",
      title: "NVIDIA-only fused result",
      product: "ovrtx RTX + Warp/CUDA + Content Agents + SimReady",
      status: "passed",
      imageUrl: ovrtxFirstFrameUrl,
      warpOverlayUrl: warpFloodDepthUrl,
      sourcePath: "ovrtx first frame + Warp depth + Content Agents/SimReady acceptance",
      caption:
        "새 메인 결과입니다. train1의 ovrtx RTX 프레임을 베이스로 쓰고, NVIDIA Warp/CUDA 수심 결과와 Content Agents/SimReady 통과 메타데이터를 한 화면에 융합했습니다.",
      evidence: `${gateEvidence(gates, "OMNIVERSE.OVRTX_FIRST_FRAME.001")} · ${gateEvidence(gates, "NVIDIA.WARP_FLOOD.001")}`,
      fused: true
    },
    {
      id: "ovrtx",
      title: "ovrtx RTX first frame",
      product: "NVIDIA Omniverse / ovrtx",
      status: "passed",
      imageUrl: ovrtxFirstFrameUrl,
      sourcePath: "docs/evidence/nvidia-train1-ovrtx-first-frame-2026-06-12.png",
      caption: "train1 NVIDIA GPU에서 sadang_317_6.ovrtx_viewer.usda를 열고 RTX LdrColor 첫 프레임을 캡처한 결과입니다.",
      evidence: gateEvidence(gates, "OMNIVERSE.OVRTX_FIRST_FRAME.001")
    },
    {
      id: "ovstream",
      title: "ovstream browser decoded frame",
      product: "NVIDIA ovstream / @nvidia/ov-web-rtc",
      status: "passed",
      imageUrl: ovstreamBrowserFrameUrl,
      sourcePath: "docs/evidence/nvidia-train1-ovstream-browser-first-frame-2026-06-12.png",
      caption: "ovrtx frame을 CUDA BGRA buffer로 변환한 뒤 ovstream/WebRTC로 브라우저가 실제 디코딩한 첫 프레임입니다.",
      evidence: gateEvidence(gates, "OMNIVERSE.OVSTREAM_BROWSER.001")
    },
    {
      id: "warp",
      title: "Warp/CUDA flood depth",
      product: "NVIDIA Warp / CUDA",
      status: "passed",
      imageUrl: warpFloodDepthUrl,
      sourcePath: "docs/evidence/nvidia-train1-warp-flood-depth-2026-06-13.png",
      caption: "브라우저 물 텍스처가 아니라 train1 CUDA GPU에서 NVIDIA Warp shallow-water smoke를 돌려 생성한 수심 프리뷰입니다.",
      evidence: gateEvidence(gates, "NVIDIA.WARP_FLOOD.001")
    }
  ];
}

export function getNvidiaEvidenceSummary(): NvidiaEvidenceSummary {
  const acceptance = object(acceptanceReport);
  const gates = array(acceptance.gates);
  const stack = object(stackManifest);
  const stageSummary = object(stack.stage_summary);
  const ovrtxSession = object(stack.ovrtx_viewer_session);
  const simreadyAsset = object(stack.simready_asset_source);
  const contentRun = object(contentAgentsRun);
  const steps = array(contentRun.steps);
  const material = findNamed(steps, "material");
  const physics = findNamed(steps, "physics");
  const materialFinal = object(material.final_status);
  const physicsFinal = object(physics.final_status);
  const materialCompleted = array(materialFinal.completed_steps);
  const physicsCompleted = array(physicsFinal.completed_steps);
  const materialDataset = findNamed(materialCompleted, "build_dataset_usd");
  const materialPredict = findNamed(materialCompleted, "predict");
  const materialRetrieval = findNamed(materialCompleted, "MaterialRetrieval");
  const physicsDataset = findNamed(physicsCompleted, "build_dataset_usd");
  const physicsIdentify = findNamed(physicsCompleted, "identify_asset");
  const materialsApplied = object(nested(materialRetrieval, ["stats", "outputs", "materials_applied"]));
  const identification = object(nested(physicsIdentify, ["stats", "outputs", "identification"]));
  const physicsLabel = [text(identification.asset_type), text(identification.asset_subtype), text(identification.confidence)]
    .filter((part) => part !== "-")
    .join(" / ");

  return {
    acceptanceStatus: text(acceptance.status),
    passedGateCount: gates.filter((gate) => text(object(gate).status) === "passed").length,
    totalGateCount: gates.length,
    stageMeshCount: number(stageSummary.mesh_count),
    stageCollisionMeshCount: number(stageSummary.physics_collision_meshes),
    stageOpenUsd: text(stageSummary.openusd_stage, "sadang_317_6.usda"),
    ovrtxStage: text(ovrtxSession.composite_stage, "sadang_317_6.ovrtx_viewer.usda"),
    materialSessionId: text(material.session_id),
    materialRenderedImages: number(nested(materialDataset, ["stats", "total_images"])),
    materialPredictions: number(nested(materialPredict, ["stats", "successful"])),
    materialAppliedCount: Object.keys(materialsApplied).length,
    physicsSessionId: text(physics.session_id),
    physicsRenderedImages: number(nested(physicsDataset, ["stats", "total_images"])),
    physicsIdentification: physicsLabel || "not reported",
    simReadyStage: text(simreadyAsset.asset_stage),
    warpEvidence: gateEvidence(gates, "NVIDIA.WARP_FLOOD.001"),
    ovstreamEvidence: gateEvidence(gates, "OMNIVERSE.OVSTREAM_SERVER.001"),
    browserEvidence: gateEvidence(gates, "OMNIVERSE.OVSTREAM_BROWSER.001"),
    workflow: text(object(materialSidecar).nvidia_workflow, text(object(physicsSidecar).nvidia_workflow)),
    caveat: bool(contentRun.passed)
      ? "기본 메인 화면은 train1에서 생성한 NVIDIA 결과 프레임·Warp 수심·Content Agents/SimReady 메타데이터를 융합한 NVIDIA-only 결과 뷰입니다. 로컬 Three.js는 비교용입니다."
      : "Content Agents 실행 증거가 통과 상태가 아닙니다."
  };
}

function metric(label: string, value: string, detail: string): string {
  return `<div class="nvidia-metric"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(detail)}</small></div>`;
}

export function nvidiaEvidenceHtml(): string {
  const summary = getNvidiaEvidenceSummary();
  const gateText = `${summary.passedGateCount}/${summary.totalGateCount} gates`;
  return `
    <div class="nvidia-card-head">
      <div>
        <span class="nvidia-kicker">NVIDIA-only main result</span>
        <b>융합 메인: ovrtx RTX frame + Warp/CUDA flood + Content Agents/SimReady</b>
      </div>
      <span class="nvidia-status ${summary.acceptanceStatus === "passed" ? "passed" : "warn"}">${escapeHtml(summary.acceptanceStatus)} · ${escapeHtml(gateText)}</span>
    </div>
    <p class="nvidia-caveat">${escapeHtml(summary.caveat)}</p>
    <div class="nvidia-visual-pickers" aria-label="NVIDIA 실제 결과 이미지 선택">
      ${getNvidiaVisualArtifacts()
        .map(
          (artifact, index) => `
            <button class="nvidia-visual-button${index === 0 ? " active" : ""}" type="button" data-nvidia-visual="${artifact.id}">
              <img src="${escapeHtml(artifact.imageUrl)}" alt="${escapeHtml(artifact.title)}" loading="lazy" />
              <span><b>${escapeHtml(artifact.title)}</b><small>${escapeHtml(artifact.product)}</small></span>
            </button>
          `
        )
        .join("")}
    </div>
    <div class="nvidia-metrics">
      ${metric("OpenUSD stage", summary.stageOpenUsd, `${summary.stageMeshCount} meshes · ${summary.stageCollisionMeshCount} collision meshes`)}
      ${metric("RTX/stream", summary.ovrtxStage, "ovrtx first frame + ovstream WebRTC browser frame passed")}
      ${metric("Warp/CUDA flood", "passed", summary.warpEvidence.replace(/^status=passed,?\s*/i, ""))}
      ${metric("Material Agent", `${summary.materialPredictions} VLM preds`, `${summary.materialRenderedImages} rendered views · ${summary.materialAppliedCount} materials`)}
      ${metric("Physics Agent", `${summary.physicsRenderedImages} views`, `session ${summary.physicsSessionId.slice(0, 8)}… · classified: ${summary.physicsIdentification}`)}
      ${metric("SimReady", "validator passed", summary.simReadyStage)}
    </div>
    <details class="nvidia-details">
      <summary>증거/주의사항 보기</summary>
      <ul>
        <li>Material session: <code>${escapeHtml(summary.materialSessionId)}</code></li>
        <li>Physics session: <code>${escapeHtml(summary.physicsSessionId)}</code></li>
        <li>ovstream: ${escapeHtml(summary.ovstreamEvidence)}</li>
        <li>browser video: ${escapeHtml(summary.browserEvidence)}</li>
        <li>주의: Physics Agent가 이 부지를 “${escapeHtml(summary.physicsIdentification)}”로 오인했습니다. 그래서 도시/침수 의미 해석은 별도 검증 대상입니다.</li>
      </ul>
    </details>
  `;
}
