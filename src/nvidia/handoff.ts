import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceManifest, TwinProject } from "../types/twin";
import type { NvidiaRuntimePreflightReport } from "./preflight";
import { writeOvstreamViewerHandoff } from "./viewerContract";

export interface HandoffFileEntry {
  path: string;
  role: string;
  required: boolean;
  size_bytes: number;
  sha256: string;
}

export interface NvidiaHandoffManifest {
  project_id: string;
  generated_at: string;
  package_root: string;
  status: "ready_for_gpu_host" | "incomplete";
  openusd_stage: string;
  runtime_preflight_status: NvidiaRuntimePreflightReport["status"];
  source_confidence: SourceManifest["geocoding"]["confidence"];
  viewer_contract: {
    path: string;
    runbook: string;
    status: "contract_authored_runtime_gated" | "ready_for_stream_validation";
  };
  files: HandoffFileEntry[];
  gpu_host_acceptance_gates: Array<{ id: string; required_status: string; evidence_to_attach: string }>;
  gpu_host_commands: string[];
  nvidia_only_constraints: string[];
}

interface FileSpec {
  path: string;
  role: string;
  required: boolean;
}

export async function writeNvidiaHandoffPackage(input: {
  packageDir: string;
  twin: TwinProject;
  sourceManifest: SourceManifest;
}): Promise<{ manifestPath: string; runbookPath: string; manifest: NvidiaHandoffManifest }> {
  const preflight = await readJson<NvidiaRuntimePreflightReport>(join(input.packageDir, "nvidia_runtime_preflight.json"));
  const runbookPath = join(input.packageDir, "NVIDIA_GPU_HOST_RUNBOOK.md");
  await writeFile(runbookPath, renderGpuHostRunbook({ twin: input.twin, sourceManifest: input.sourceManifest, preflight }), "utf8");
  const viewerHandoff = await writeOvstreamViewerHandoff({
    packageDir: input.packageDir,
    twin: input.twin,
    sourceManifest: input.sourceManifest,
    preflight
  });

  const files = await Promise.all(
    handoffFileSpecs(input.twin.project_id).map((spec) => hashPackageFile(input.packageDir, spec))
  );
  const manifest = buildHandoffManifest({
    twin: input.twin,
    sourceManifest: input.sourceManifest,
    preflight,
    files,
    viewerContractStatus: viewerHandoff.contract.status
  });
  const manifestPath = join(input.packageDir, "handoff_manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, runbookPath, manifest };
}

function handoffFileSpecs(projectId: string): FileSpec[] {
  return [
    { path: `${projectId}.usda`, role: "OpenUSD stage to open in Omniverse/ovrtx", required: true },
    { path: `${projectId}.ovrtx_viewer.usda`, role: "ovrtx viewer/session wrapper with Camera, RenderProduct, RenderVar, and RenderSettings", required: true },
    { path: "nvidia_ovrtx_first_frame.py", role: "NVIDIA ovrtx first-frame smoke script for GPU-host evidence capture", required: true },
    { path: "nvidia_ovstream_smoke_server.py", role: "NVIDIA ovrtx-to-ovstream WebRTC readiness smoke server", required: true },
    { path: "nvidia_warp_flood_smoke.py", role: "NVIDIA Warp/CUDA shallow-water flood simulation smoke script", required: true },
    { path: "ovstream_browser_client/package.json", role: "NVIDIA ov-web-rtc Direct browser client manifest", required: true },
    { path: "ovstream_browser_client/package-lock.json", role: "NVIDIA ov-web-rtc Direct browser client lockfile", required: true },
    { path: "ovstream_browser_client/.npmrc", role: "NVIDIA npm registry scope for ov-web-rtc client", required: true },
    { path: "ovstream_browser_client/index.html", role: "Browser HTML video surface for ovstream WebRTC", required: true },
    { path: "ovstream_browser_client/src/main.ts", role: "NVIDIA ov-web-rtc Direct connection logic", required: true },
    { path: "ovstream_browser_client/src/style.css", role: "Video-only browser viewer layout", required: true },
    { path: "ovstream_browser_client/scripts/probe-first-frame.mjs", role: "Playwright browser video first-frame validation probe", required: true },
    { path: "ovstream_browser_client/README.md", role: "Browser client run and validation instructions", required: true },
    { path: "nvidia_stack_manifest.json", role: "NVIDIA product mapping and current local gate status", required: true },
    { path: "nvidia_runtime_preflight.json", role: "machine-readable runtime gate report", required: true },
    { path: "nvidia_runtime_preflight.md", role: "human-readable runtime gate report", required: true },
    { path: "simready_minimum_report.json", role: "authored SimReady candidate report plus external Content Agents gates", required: true },
    { path: `simready_asset/${projectId}/simready_usd/${projectId}.usda`, role: "self-contained SimReady validator asset-source copy", required: true },
    { path: `simready_asset/${projectId}/simready_usd/${projectId}.json`, role: "SimReady sidecar metadata for validator NP.006", required: true },
    { path: "usdchecker_report.txt", role: "local OpenUSD validator evidence", required: true },
    { path: "README.md", role: "package overview", required: true },
    { path: "NVIDIA_GPU_HOST_RUNBOOK.md", role: "GPU host validation runbook", required: true },
    { path: "ovstream_viewer_contract.json", role: "NVIDIA ovstream/WebRTC viewer contract", required: true },
    { path: "OVSTREAM_VIEWER_RUNBOOK.md", role: "NVIDIA ovstream/WebRTC viewer runbook", required: true },
    { path: "../twin.json", role: "source digital-twin artifact", required: true },
    { path: "../source_manifest.json", role: "source provenance and confidence artifact", required: true }
  ];
}

export function buildHandoffManifest(input: {
  twin: TwinProject;
  sourceManifest: SourceManifest;
  preflight: NvidiaRuntimePreflightReport;
  files: HandoffFileEntry[];
  viewerContractStatus?: "contract_authored_runtime_gated" | "ready_for_stream_validation";
}): NvidiaHandoffManifest {
  const missingRequired = input.files.some((file) => file.required && file.size_bytes <= 0);
  return {
    project_id: input.twin.project_id,
    generated_at: input.sourceManifest.generated_at || input.twin.created_at,
    package_root: `src/samples/${input.twin.project_id}/omniverse`,
    status: missingRequired ? "incomplete" : "ready_for_gpu_host",
    openusd_stage: `${input.twin.project_id}.usda`,
    runtime_preflight_status: input.preflight.status,
    source_confidence: input.sourceManifest.geocoding.confidence,
    viewer_contract: {
      path: "ovstream_viewer_contract.json",
      runbook: "OVSTREAM_VIEWER_RUNBOOK.md",
      status: input.viewerContractStatus ?? "contract_authored_runtime_gated"
    },
    files: input.files,
    gpu_host_acceptance_gates: [
      {
        id: "NVIDIA.GPU.001",
        required_status: "passed",
        evidence_to_attach: "nvidia-smi output showing GPU name, driver version, and memory."
      },
      {
        id: "OMNIVERSE.VIEWER.001",
        required_status: "passed",
        evidence_to_attach: `ovrtx first-frame report/image from ${input.twin.project_id}.ovrtx_viewer.usda, or Omniverse/Kit load evidence for the OpenUSD stage.`
      },
      {
        id: "OMNIVERSE.OVSTREAM.001",
        required_status: "passed for browser-delivered NVIDIA-only viewer",
        evidence_to_attach: "ovstream lifecycle check, signaling/stream URL, ovstream smoke server /healthz report, server first-frame readiness log, and browser video first-frame capture."
      },
      {
        id: "NVIDIA.WARP_FLOOD.001",
        required_status: "passed before claiming NVIDIA-only hydrology runtime",
        evidence_to_attach: "NVIDIA Warp flood report JSON and depth PGM from nvidia_warp_flood_smoke.py on a CUDA GPU host."
      },
      {
        id: "CONTENT_AGENTS.RUNTIME.001",
        required_status: "passed before Content-Agents-assisted SimReady claim",
        evidence_to_attach: "Content Agents material/physics assignment logs or endpoint health + request IDs."
      },
      {
        id: "SIMREADY.VALIDATOR.001",
        required_status: "passed before formal SimReady profile claim",
        evidence_to_attach: "Omniverse Asset Validator / SimReady report copied back into this package."
      }
    ],
    gpu_host_commands: [
      "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader",
      `usdchecker ${input.twin.project_id}.usda`,
      `python3 nvidia_ovrtx_first_frame.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm`,
      `python3 nvidia_ovstream_smoke_server.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovstream_smoke_report.json`,
      `python3 nvidia_warp_flood_smoke.py --stage ${input.twin.project_id}.usda --output-json warp_flood_report.json --output-pgm warp_flood_depth.pgm`,
      "cd ovstream_browser_client && npm install && npm run build && npm run dev -- --port 5191",
      "cd ovstream_browser_client && npm run probe:first-frame -- --url http://127.0.0.1:5191/?server=127.0.0.1\\&signalingport=49100 --output-json browser_first_frame_report.json --screenshot browser_first_frame.png",
      "npm run nvidia:preflight",
      "npm run nvidia:content-agents:deploy:plan",
      "NVIDIA_API_KEY_FILE=/secure/path/nvidia_api_key npm run nvidia:content-agents:deploy -- up",
      "npm run nvidia:content-agents:deploy:status -- --wait-seconds 900",
      "source .tmp/nvidia-content-agents/endpoints.env",
      "npm run nvidia:content-agents",
      "npm run nvidia:simready",
      "Open the stage in NVIDIA Omniverse / Kit / ovrtx and capture render evidence.",
      "Expose an ovstream/WebRTC browser viewer and attach first-frame stream evidence.",
      "Run Content Agents Material→Physics assignment, then rerun SimReady/Asset Validator on the updated output."
    ],
    nvidia_only_constraints: [
      "Do not use the browser Three.js/WebGL viewer as final USD-render acceptance evidence.",
      "Browser UI for the NVIDIA-only viewer must display ovstream/WebRTC video, not client-rendered USD geometry.",
      "Do not claim Content-Agents-assisted SimReady conformance until Content Agents material/physics assignment has run; an authored self-contained asset-source copy may still pass profile validation independently.",
      "The flood-water layer is a visual/result placeholder and must be replaced by an NVIDIA runtime simulation/stream if operational hydrology is required."
    ]
  };
}

export function renderGpuHostRunbook(input: {
  twin: TwinProject;
  sourceManifest: SourceManifest;
  preflight: NvidiaRuntimePreflightReport;
}): string {
  return `# NVIDIA GPU Host Runbook — ${input.twin.project_id}

This handoff is for the NVIDIA-only runtime path. The local package can author and validate OpenUSD, but final visual acceptance must come from NVIDIA Omniverse / RTX / ovrtx, not the browser WebGL MVP.

## Package state

- Source confidence: ${input.sourceManifest.geocoding.confidence}
- Local preflight status: ${input.preflight.status}
- OpenUSD stage: \`${input.twin.project_id}.usda\`
- ovrtx viewer wrapper: \`${input.twin.project_id}.ovrtx_viewer.usda\`
- ovrtx first-frame smoke: \`nvidia_ovrtx_first_frame.py\`
- ovstream readiness smoke: \`nvidia_ovstream_smoke_server.py\`
- NVIDIA Warp flood smoke: \`nvidia_warp_flood_smoke.py\`
- ovstream browser client: \`ovstream_browser_client/\`
- Local authoring evidence: \`usdchecker_report.txt\`
- SimReady baseline: \`simready_minimum_report.json\` includes USD units/axis/material binding plus conservative static PhysicsCollisionAPI/PhysicsMassAPI semantics.
- SimReady validator asset source: \`simready_asset/${input.twin.project_id}/simready_usd/${input.twin.project_id}.usda\` plus sidecar metadata. Use this path for SimReady Foundation validation folder/metadata rules.
- Browser viewer replacement: \`ovstream_viewer_contract.json\` + \`OVSTREAM_VIEWER_RUNBOOK.md\` define the NVIDIA-only WebRTC video-stream path.

## 1. Transfer

Copy this folder and the two source files beside it:

\`\`\`bash
scp -r src/samples/${input.twin.project_id}/omniverse <gpu-host>:/data/${input.twin.project_id}/
scp src/samples/${input.twin.project_id}/twin.json src/samples/${input.twin.project_id}/source_manifest.json <gpu-host>:/data/${input.twin.project_id}/
\`\`\`

## 2. GPU host smoke gates

Run on the NVIDIA machine:

\`\`\`bash
cd /data/${input.twin.project_id}/omniverse
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
usdchecker ${input.twin.project_id}.usda
export OVRTX_SKIP_USD_CHECK=1
python3 nvidia_ovrtx_first_frame.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm
python3 nvidia_ovstream_smoke_server.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovstream_smoke_report.json
python3 nvidia_warp_flood_smoke.py --stage ${input.twin.project_id}.usda --output-json warp_flood_report.json --output-pgm warp_flood_depth.pgm
cd ovstream_browser_client
npm install
npm run build
\`\`\`

If running from the full repository checkout, also run:

\`\`\`bash
npm ci
npm run nvidia:preflight
npm run nvidia:content-agents:deploy-audit
npm run nvidia:content-agents:deploy:plan
npm run nvidia:content-agents:deploy:status
npm run nvidia:content-agents:check
npm run nvidia:simready
\`\`\`

Acceptance threshold: \`nvidia_runtime_preflight.json\` should move from \`${input.preflight.status}\` to \`nvidia_runtime_ready\` before claiming local NVIDIA runtime readiness.

## 3. Omniverse / ovrtx validation

1. Open \`${input.twin.project_id}.ovrtx_viewer.usda\` in NVIDIA Omniverse, Kit, or ovrtx for the first-frame smoke; open \`${input.twin.project_id}.usda\` directly for source-stage inspection.
2. Confirm the stage loads with meter units, Y-up axis, official buildings, roads, parcel boundary, terrain reference, flood-water reference layer, materials, and static collider APIs.
3. Follow \`OVSTREAM_VIEWER_RUNBOOK.md\` to expose browser delivery through ovstream/WebRTC only. The smoke server proves server readiness; browser decode still needs a video first-frame capture.
4. Run \`nvidia_warp_flood_smoke.py\` with NVIDIA Warp/warp-lang on CUDA to replace the browser MVP water texture with NVIDIA hydrology-smoke evidence.
5. Attach screenshot, stream URL, render log, Warp flood report, and depth PGM back to the package.

## 4. SimReady completion gates

This package includes an authored SimReady candidate and a self-contained validator asset source. Before saying “Content-Agents-assisted SimReady”:

1. If endpoints already exist, export \`CONTENT_AGENTS_MATERIAL_AGENT_BASE_URL\` and \`CONTENT_AGENTS_PHYSICS_AGENT_BASE_URL\`. Otherwise set \`NVIDIA_API_KEY\` or \`NVIDIA_API_KEY_FILE\` on the GPU host and run \`npm run nvidia:content-agents:deploy -- up\`. The repo deploy bridge uses the official NVIDIA upstream Docker Compose files, remaps Material/Physics to \`8100/8200\` with OVRTX sidecars on \`8101/8201\`, auto-pins the sidecars to separate GPUs when multiple GPUs are visible, and writes \`.tmp/nvidia-content-agents/endpoints.env\`.
2. Run \`npm run nvidia:content-agents:deploy:status -- --wait-seconds 900\`, then \`source .tmp/nvidia-content-agents/endpoints.env\` and run \`npm run nvidia:content-agents\`.
3. Run \`npm run nvidia:simready\` or Omniverse Asset Validator / SimReady validation against \`simready_asset/${input.twin.project_id}/simready_usd/${input.twin.project_id}.usda\`.
4. Copy validator reports into this package and update \`handoff_manifest.json\` checksums.
5. Run USD Performance Tuning if the scene is scaled beyond this MVP sample.

## 5. Do not fake these gates

- Browser Three.js screenshots do not count for NVIDIA-only USD render acceptance.
- Browser-side WebGL/Three.js/Babylon/glTF rendering is forbidden for the NVIDIA-only viewer path; the browser may display only the ovstream video plus UI.
- The static flood-water plane is not an NVIDIA hydrology solve.
- Do not claim NVIDIA-only flood simulation until \`nvidia_warp_flood_smoke.py\` passes on CUDA and its report is attached.
- The Mac/local preflight cannot satisfy RTX, ovrtx, NVIDIA Container Toolkit, or Content Agents runtime gates without an NVIDIA GPU host.
`;
}

async function hashPackageFile(packageDir: string, spec: FileSpec): Promise<HandoffFileEntry> {
  const filePath = join(packageDir, spec.path);
  const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    path: spec.path,
    role: spec.role,
    required: spec.required,
    size_bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
