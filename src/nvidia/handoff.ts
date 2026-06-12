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
    { path: "nvidia_stack_manifest.json", role: "NVIDIA product mapping and current local gate status", required: true },
    { path: "nvidia_runtime_preflight.json", role: "machine-readable runtime gate report", required: true },
    { path: "nvidia_runtime_preflight.md", role: "human-readable runtime gate report", required: true },
    { path: "simready_minimum_report.json", role: "minimum SimReady candidate report and blocked external gates", required: true },
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
        evidence_to_attach: "Omniverse/Kit/ovrtx load evidence for the OpenUSD stage; screenshot or stream URL is acceptable."
      },
      {
        id: "OMNIVERSE.OVSTREAM.001",
        required_status: "passed for browser-delivered NVIDIA-only viewer",
        evidence_to_attach: "ovstream lifecycle check, signaling/stream URL, server first-frame readiness log, and browser video first-frame capture."
      },
      {
        id: "CONTENT_AGENTS.RUNTIME.001",
        required_status: "passed before full SimReady claim",
        evidence_to_attach: "Content Agents material/physics assignment logs or endpoint health + request IDs."
      },
      {
        id: "SIMREADY.VALIDATOR.001",
        required_status: "passed before full SimReady claim",
        evidence_to_attach: "Omniverse Asset Validator / SimReady report copied back into this package."
      }
    ],
    gpu_host_commands: [
      "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader",
      `usdchecker ${input.twin.project_id}.usda`,
      "npm run nvidia:preflight",
      "Open the stage in NVIDIA Omniverse / Kit / ovrtx and capture render evidence.",
      "Expose an ovstream/WebRTC browser viewer and attach first-frame stream evidence.",
      "Run Content Agents material/physics assignment, then SimReady/Asset Validator."
    ],
    nvidia_only_constraints: [
      "Do not use the browser Three.js/WebGL viewer as final USD-render acceptance evidence.",
      "Browser UI for the NVIDIA-only viewer must display ovstream/WebRTC video, not client-rendered USD geometry.",
      "Do not claim full SimReady conformance from this Mac-authored package; only the authored baseline and usdchecker pass locally.",
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
- Local authoring evidence: \`usdchecker_report.txt\`
- SimReady baseline: \`simready_minimum_report.json\` includes USD units/axis/material binding plus conservative static PhysicsCollisionAPI semantics.
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
\`\`\`

If running from the full repository checkout, also run:

\`\`\`bash
npm ci
npm run nvidia:preflight
\`\`\`

Acceptance threshold: \`nvidia_runtime_preflight.json\` should move from \`${input.preflight.status}\` to \`nvidia_runtime_ready\` before claiming local NVIDIA runtime readiness.

## 3. Omniverse / ovrtx validation

1. Open \`${input.twin.project_id}.usda\` in NVIDIA Omniverse, Kit, or ovrtx.
2. Confirm the stage loads with meter units, Y-up axis, official buildings, roads, parcel boundary, terrain reference, flood-water reference layer, materials, and static collider APIs.
3. Follow \`OVSTREAM_VIEWER_RUNBOOK.md\` to expose browser delivery through ovstream/WebRTC only.
4. Attach screenshot, stream URL, or render log back to the package.

## 4. SimReady completion gates

This package is only a conservative SimReady candidate. Before saying “full SimReady”:

1. Run Omniverse Content Agents for material and physics assignment.
2. Run Omniverse Asset Validator / SimReady validation.
3. Copy validator reports into this package and update \`handoff_manifest.json\` checksums.
4. Run USD Performance Tuning if the scene is scaled beyond this MVP sample.

## 5. Do not fake these gates

- Browser Three.js screenshots do not count for NVIDIA-only USD render acceptance.
- Browser-side WebGL/Three.js/Babylon/glTF rendering is forbidden for the NVIDIA-only viewer path; the browser may display only the ovstream video plus UI.
- The static flood-water plane is not an NVIDIA hydrology solve.
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
