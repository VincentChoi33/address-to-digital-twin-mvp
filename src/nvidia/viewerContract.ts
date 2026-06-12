import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceManifest, TwinProject } from "../types/twin";
import type { NvidiaRuntimePreflightReport } from "./preflight";

export interface NvidiaOvstreamViewerContract {
  project_id: string;
  generated_at: string;
  status: "contract_authored_runtime_gated" | "ready_for_stream_validation";
  usd_stage: string;
  renderer: {
    product: "NVIDIA Omniverse RTX / ovrtx";
    ownership: string;
    required_runtime: string[];
  };
  transport: {
    product: "NVIDIA ovstream WebRTC";
    browser_surface: "video_stream_only";
    fixed_resolution_per_session: boolean;
    readiness_rule: string;
  };
  source_artifacts: {
    twin_json: string;
    source_manifest_json: string;
    source_confidence: SourceManifest["geocoding"]["confidence"];
  };
  runtime_gates: Array<{ id: string; required_for: string; current_status: string; evidence_required: string }>;
  browser_client_contract: {
    allowed_render_surface: string;
    forbidden_renderers: string[];
    data_channel_messages: Array<{ type: string; owner: "browser" | "ovrtx_server"; payload: string }>;
    input_routing: string;
  };
  validation_artifacts_to_attach: string[];
}

export async function writeOvstreamViewerHandoff(input: {
  packageDir: string;
  twin: TwinProject;
  sourceManifest: SourceManifest;
  preflight: NvidiaRuntimePreflightReport;
}): Promise<{ contractPath: string; runbookPath: string; contract: NvidiaOvstreamViewerContract }> {
  const contract = buildOvstreamViewerContract(input);
  const contractPath = join(input.packageDir, "ovstream_viewer_contract.json");
  const runbookPath = join(input.packageDir, "OVSTREAM_VIEWER_RUNBOOK.md");
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  await writeFile(runbookPath, renderOvstreamViewerRunbook(input), "utf8");
  return { contractPath, runbookPath, contract };
}

export function buildOvstreamViewerContract(input: {
  twin: TwinProject;
  sourceManifest: SourceManifest;
  preflight: NvidiaRuntimePreflightReport;
}): NvidiaOvstreamViewerContract {
  const streamReady = Boolean(input.preflight.summary.omniverse_streaming_ready);
  return {
    project_id: input.twin.project_id,
    generated_at: input.sourceManifest.generated_at || input.twin.created_at,
    status: streamReady ? "ready_for_stream_validation" : "contract_authored_runtime_gated",
    usd_stage: `${input.twin.project_id}.usda`,
    renderer: {
      product: "NVIDIA Omniverse RTX / ovrtx",
      ownership:
        "Server-side NVIDIA runtime owns USD stage loading, renderer.step(), camera/session layers, native picking, selection writes, and live USD mutations.",
      required_runtime: ["NVIDIA GPU + driver", "ovrtx or Omniverse Kit runtime", "OpenUSD tools", "NVENC-capable streaming path"]
    },
    transport: {
      product: "NVIDIA ovstream WebRTC",
      browser_surface: "video_stream_only",
      fixed_resolution_per_session: true,
      readiness_rule:
        "A /healthz-style ready signal must mean the ovrtx server produced and copied the first valid RTX frame into the ovstream buffer; browser connection alone is not readiness."
    },
    source_artifacts: {
      twin_json: "../twin.json",
      source_manifest_json: "../source_manifest.json",
      source_confidence: input.sourceManifest.geocoding.confidence
    },
    runtime_gates: [
      {
        id: "NVIDIA.GPU.001",
        required_for: "RTX rendering and NVENC-backed streaming",
        current_status: gateStatus(input.preflight, "NVIDIA.GPU.001"),
        evidence_required: "nvidia-smi output from the GPU host"
      },
      {
        id: "OMNIVERSE.VIEWER.001",
        required_for: "ovrtx/Kit stage loading and RTX frame production",
        current_status: gateStatus(input.preflight, "OMNIVERSE.VIEWER.001"),
        evidence_required: "ovrtx/Kit process log plus first-frame readiness evidence"
      },
      {
        id: "OMNIVERSE.OVSTREAM.001",
        required_for: "browser-delivered NVIDIA-only viewer",
        current_status: gateStatus(input.preflight, "OMNIVERSE.OVSTREAM.001"),
        evidence_required: "ovstream import/lifecycle check, ovstream smoke server /healthz report, signaling URL, and browser video first-frame capture"
      }
    ],
    browser_client_contract: {
      allowed_render_surface: "HTML video element displaying the ovstream WebRTC media track with object-fit: contain",
      forbidden_renderers: ["WebGL", "Three.js", "Babylon.js", "PlayCanvas", "A-Frame", "model-viewer", "react-three-fiber", "glTF browser viewer"],
      data_channel_messages: [
        { type: "viewer.ready", owner: "ovrtx_server", payload: "server frame readiness and stage metadata" },
        { type: "camera.set", owner: "browser", payload: "named camera preset or orbital camera intent; server applies it in session state" },
        { type: "layer.visibility", owner: "browser", payload: "semantic layer id and visibility boolean; server mutates session/composite layer only" },
        { type: "selection.changed", owner: "ovrtx_server", payload: "native picking result, prim path, and display metadata" },
        { type: "render.aov", owner: "browser", payload: "requested AOV/render mode; server validates and applies" }
      ],
      input_routing:
        "Mouse, keyboard, wheel, and touch input must use NVIDIA native streaming input forwarding where available; do not invent JSON mouse events for USD picking."
    },
    validation_artifacts_to_attach: [
      "nvidia-smi output",
      "ovrtx/Kit first-frame server log",
      "ovrtx-to-ovstream smoke server report",
      "ovstream import/lifecycle check output",
      "browser video first-frame screenshot or stream capture",
      "updated nvidia_runtime_preflight.json from the GPU host"
    ]
  };
}

export function renderOvstreamViewerRunbook(input: {
  twin: TwinProject;
  sourceManifest: SourceManifest;
  preflight: NvidiaRuntimePreflightReport;
}): string {
  const contract = buildOvstreamViewerContract(input);
  return `# NVIDIA ovstream Viewer Runbook — ${input.twin.project_id}

This file defines the browser viewer replacement for the Three.js MVP. It is a runtime-gated handoff, not a fake local renderer: the browser must display NVIDIA ovstream WebRTC video produced by an Omniverse RTX / ovrtx server.

## Contract summary

- Contract JSON: \`ovstream_viewer_contract.json\`
- Stage: \`${contract.usd_stage}\`
- ovrtx wrapper: \`${input.twin.project_id}.ovrtx_viewer.usda\`
- Contract status: \`${contract.status}\`
- Current preflight status: \`${input.preflight.status}\`
- Browser render surface: \`${contract.browser_client_contract.allowed_render_surface}\`

## GPU host checks

Run these on the NVIDIA host before claiming the viewer is live:

\`\`\`bash
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
python3 -c "import ovstream; ovstream.initialize(); print('ovstream OK', ovstream.get_version()); ovstream.shutdown()"
export OVRTX_SKIP_USD_CHECK=1
usdchecker ${contract.usd_stage}
python3 nvidia_ovrtx_first_frame.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm
python3 nvidia_ovstream_smoke_server.py --stage ${input.twin.project_id}.ovrtx_viewer.usda --output-json ovstream_smoke_report.json
\`\`\`

Then start the ovrtx/Omniverse server for \`${input.twin.project_id}.ovrtx_viewer.usda\`, register ovstream callbacks before serving clients, and expose a readiness endpoint only after the first valid RTX frame has been copied into the stream buffer. The smoke server proves this server readiness rule; final acceptance still needs a browser video first-frame capture.

## Browser client rules

- Use a WebRTC video element only; use \`object-fit: contain\` and fixed stream resolution per session.
- Send camera/layer/AOV commands over the data channel; the server owns all USD stage mutation.
- Use NVIDIA native streaming input forwarding for mouse/keyboard/wheel/touch where available.
- Attach browser first-frame evidence to this package.

## Forbidden shortcuts

${contract.browser_client_contract.forbidden_renderers.map((renderer) => `- ${renderer}`).join("\n")}

A browser WebGL screenshot can remain a fast MVP preview, but it is not NVIDIA-only viewer acceptance evidence.
`;
}

function gateStatus(report: NvidiaRuntimePreflightReport, id: string): string {
  return report.gates.find((gate) => gate.id === id)?.status ?? "not_run";
}
