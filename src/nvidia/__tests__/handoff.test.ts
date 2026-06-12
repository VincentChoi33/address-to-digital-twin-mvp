import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import type { NvidiaRuntimePreflightReport } from "../preflight";
import { buildHandoffManifest, renderGpuHostRunbook, type HandoffFileEntry } from "../handoff";

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
  gates: [],
  redacted_environment: {},
  next_actions: []
};
const files: HandoffFileEntry[] = [
  {
    path: "sadang_317_6.usda",
    role: "OpenUSD stage",
    required: true,
    size_bytes: 42,
    sha256: "a".repeat(64)
  }
];

describe("NVIDIA GPU host handoff", () => {
  it("builds a deterministic manifest with NVIDIA-only acceptance gates", () => {
    const manifest = buildHandoffManifest({ twin, sourceManifest, preflight, files });

    expect(manifest.status).toBe("ready_for_gpu_host");
    expect(manifest.runtime_preflight_status).toBe("openusd_ready");
    expect(manifest.viewer_contract.path).toBe("ovstream_viewer_contract.json");
    expect(manifest.files[0].sha256).toHaveLength(64);
    expect(manifest.gpu_host_acceptance_gates.map((gate) => gate.id)).toContain("OMNIVERSE.VIEWER.001");
    expect(manifest.gpu_host_acceptance_gates.map((gate) => gate.id)).toContain("OMNIVERSE.OVSTREAM.001");
    expect(manifest.gpu_host_commands.join(" ")).toContain("nvidia_ovrtx_first_frame.py");
    expect(manifest.gpu_host_commands.join(" ")).toContain("nvidia_ovstream_smoke_server.py");
    expect(manifest.nvidia_only_constraints.join(" ")).toContain("Do not use the browser Three.js/WebGL viewer");
  });

  it("renders a runbook that blocks fake SimReady/RTX claims", () => {
    const runbook = renderGpuHostRunbook({ twin, sourceManifest, preflight });

    expect(runbook).toContain("nvidia-smi");
    expect(runbook).toContain(`usdchecker ${twin.project_id}.usda`);
    expect(runbook).toContain(`${twin.project_id}.ovrtx_viewer.usda`);
    expect(runbook).toContain("nvidia_ovstream_smoke_server.py");
    expect(runbook).toContain("nvidia_runtime_ready");
    expect(runbook).toContain("Browser Three.js screenshots do not count");
  });
});
