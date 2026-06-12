import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import { runNvidiaRuntimePreflight, runtimeProbeFromPreflight, type RuntimeCommandResult, type RuntimeCommandRunner } from "../preflight";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;

function result(ok: boolean, stdout = "", stderr = ""): RuntimeCommandResult {
  return { ok, stdout, stderr, code: ok ? 0 : 1 };
}

function runner(overrides: Record<string, RuntimeCommandResult>, env: Record<string, string> = {}): RuntimeCommandRunner {
  return {
    run(command: string): RuntimeCommandResult {
      return overrides[command] ?? result(false, "", `${command}: not found`);
    },
    exists(): boolean {
      return false;
    },
    env(name: string): string | undefined {
      return env[name];
    }
  };
}

describe("NVIDIA runtime preflight", () => {
  it("keeps OpenUSD ready while blocking RTX/Content Agents on a non-NVIDIA workstation", () => {
    const report = runNvidiaRuntimePreflight(
      twin,
      manifest,
      runner({
        python3: result(false),
        usdchecker: result(true, "usdchecker help"),
        docker: result(true, "Docker version 27.0.0")
      })
    );

    expect(report.status).toBe("openusd_ready");
    expect(report.summary.openusd_authoring_ready).toBe(true);
    expect(report.summary.omniverse_rtx_ready).toBe(false);
    expect(report.summary.omniverse_streaming_ready).toBe(false);
    expect(report.gates.find((gate) => gate.id === "NVIDIA.GPU.001")?.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.id === "OMNIVERSE.OVSTREAM.001")?.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.id === "CONTENT_AGENTS.RUNTIME.001")?.status).toBe("blocked");
    expect(runtimeProbeFromPreflight(report).usdChecker).toBe("available");
  });

  it("passes the full local NVIDIA runtime when GPU, Docker runtime, viewer, USD, and auth are present", () => {
    const report = runNvidiaRuntimePreflight(
      twin,
      manifest,
      runner(
        {
          "nvidia-smi": result(true, "NVIDIA RTX 6000 Ada, 555.10, 49140 MiB"),
          docker: result(true, '{"nvidia":{"path":"nvidia-container-runtime"}}'),
          python3: result(true, "pxr-usd-ok"),
          usdchecker: result(true, "usdchecker help"),
          ovrtx: result(true, "ovrtx help")
        },
        { NVIDIA_API_KEY: "secret", OVSTREAM_SIGNALING_URL: "wss://stream.example.invalid" }
      )
    );

    expect(report.status).toBe("nvidia_runtime_ready");
    expect(report.summary.omniverse_rtx_ready).toBe(true);
    expect(report.summary.omniverse_streaming_ready).toBe(true);
    expect(report.summary.content_agents_ready).toBe(true);
    expect(report.redacted_environment.NVIDIA_API_KEY).toBe("present");
    expect(report.redacted_environment.OVSTREAM_SIGNALING_URL).toBe("present");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
