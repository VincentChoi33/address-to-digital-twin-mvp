import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import type { NvidiaRuntimePreflightReport } from "../preflight";
import { buildOvstreamViewerContract, renderOvstreamViewerRunbook } from "../viewerContract";

const twin = sadangTwin as unknown as TwinProject;
const sourceManifest = sadangManifest as unknown as SourceManifest;
const preflight: NvidiaRuntimePreflightReport = {
  project_id: twin.project_id,
  generated_at: sourceManifest.generated_at,
  status: "openusd_ready",
  summary: {
    openusd_authoring_ready: true,
    omniverse_rtx_ready: false,
    omniverse_streaming_ready: false,
    simready_automation_ready: false,
    content_agents_ready: false
  },
  commands: {},
  gates: [
    { id: "NVIDIA.GPU.001", product: "NVIDIA GPU", status: "blocked", required_for: [], evidence: "missing" },
    { id: "OMNIVERSE.VIEWER.001", product: "Omniverse", status: "blocked", required_for: [], evidence: "missing" },
    { id: "OMNIVERSE.OVSTREAM.001", product: "ovstream", status: "blocked", required_for: [], evidence: "missing" }
  ],
  redacted_environment: {},
  next_actions: []
};

describe("NVIDIA ovstream viewer contract", () => {
  it("forbids browser-side USD renderers and records ovstream gates", () => {
    const contract = buildOvstreamViewerContract({ twin, sourceManifest, preflight });

    expect(contract.status).toBe("contract_authored_runtime_gated");
    expect(contract.renderer.product).toBe("NVIDIA Omniverse RTX / ovrtx");
    expect(contract.transport.product).toBe("NVIDIA ovstream WebRTC");
    expect(contract.browser_client_contract.allowed_render_surface).toContain("HTML video");
    expect(contract.browser_client_contract.forbidden_renderers).toContain("Three.js");
    expect(contract.runtime_gates.map((gate) => gate.id)).toContain("OMNIVERSE.OVSTREAM.001");
  });

  it("renders a GPU-host runbook without pretending local WebGL is acceptable", () => {
    const runbook = renderOvstreamViewerRunbook({ twin, sourceManifest, preflight });

    expect(runbook).toContain("ovstream.initialize");
    expect(runbook).toContain("OVRTX_SKIP_USD_CHECK=1");
    expect(runbook).toContain("nvidia_ovrtx_first_frame.py");
    expect(runbook).toContain("nvidia_ovstream_smoke_server.py");
    expect(runbook).toContain("WebRTC video");
    expect(runbook).toContain("not NVIDIA-only viewer acceptance evidence");
  });
});
