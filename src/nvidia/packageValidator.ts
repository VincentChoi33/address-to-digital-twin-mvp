import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { NvidiaHandoffManifest } from "./handoff";
import type { NvidiaRuntimePreflightReport } from "./preflight";
import type { NvidiaOvstreamViewerContract } from "./viewerContract";

export type PackageValidationStatus = "passed" | "failed";

export interface PackageValidationCheck {
  id: string;
  status: PackageValidationStatus;
  evidence: string;
}

export interface NvidiaPackageValidationReport {
  package_dir: string;
  status: PackageValidationStatus;
  checks: PackageValidationCheck[];
}

export async function validateNvidiaPackage(packageDir: string): Promise<NvidiaPackageValidationReport> {
  const checks: PackageValidationCheck[] = [];
  const handoff = await readJson<NvidiaHandoffManifest>(join(packageDir, "handoff_manifest.json"));
  const compositeStage = handoff.openusd_stage.replace(/\.usda$/i, ".ovrtx_viewer.usda");
  const [preflight, viewerContract, usda, compositeUsda, firstFrameScript, ovstreamScript, browserPackage, browserMain, browserHtml, browserProbe, usdcheckerReport] = await Promise.all([
    readJson<NvidiaRuntimePreflightReport>(join(packageDir, "nvidia_runtime_preflight.json")),
    readJson<NvidiaOvstreamViewerContract>(join(packageDir, "ovstream_viewer_contract.json")),
    readFile(join(packageDir, handoff.openusd_stage), "utf8"),
    readFile(join(packageDir, compositeStage), "utf8"),
    readFile(join(packageDir, "nvidia_ovrtx_first_frame.py"), "utf8"),
    readFile(join(packageDir, "nvidia_ovstream_smoke_server.py"), "utf8"),
    readFile(join(packageDir, "ovstream_browser_client/package.json"), "utf8"),
    readFile(join(packageDir, "ovstream_browser_client/src/main.ts"), "utf8"),
    readFile(join(packageDir, "ovstream_browser_client/index.html"), "utf8"),
    readFile(join(packageDir, "ovstream_browser_client/scripts/probe-first-frame.mjs"), "utf8"),
    readFile(join(packageDir, "usdchecker_report.txt"), "utf8")
  ]);

  checks.push(passIf("HANDOFF.STATUS.001", handoff.status === "ready_for_gpu_host", `handoff status=${handoff.status}`));
  checks.push(...(await validateHandoffFiles(packageDir, handoff)));
  checks.push(passIf("USD.UNITS.001", usda.includes("metersPerUnit = 1"), "USD stage contains metersPerUnit = 1."));
  checks.push(passIf("USD.MATERIAL_BINDING.001", usda.includes("MaterialBindingAPI"), "USD stage contains MaterialBindingAPI."));
  checks.push(passIf("USD.PHYSICS_SCENE.001", usda.includes('def PhysicsScene "PhysicsScene"'), "USD stage contains PhysicsScene."));
  checks.push(passIf("USD.PHYSICS_COLLISION.001", countMatches(usda, "PhysicsCollisionAPI") >= 1 && countMatches(usda, "physics:collisionEnabled") >= 1, `collision APIs=${countMatches(usda, "PhysicsCollisionAPI")}, enabled=${countMatches(usda, "physics:collisionEnabled")}`));
  checks.push(passIf("OVRTX.COMPOSITE_SUBLAYER.001", compositeUsda.includes(`@${handoff.openusd_stage}@`), "ovrtx wrapper sublayers the source OpenUSD stage by basename."));
  checks.push(passIf("OVRTX.RENDER_PIPELINE.001", ["def Camera \"OVCamera\"", "def RenderProduct \"ViewportTexture0\"", "def RenderVar \"LdrColor\"", "def RenderSettings \"OVRenderSettings\""].every((token) => compositeUsda.includes(token)), "ovrtx wrapper authors Camera -> RenderProduct -> RenderVar -> RenderSettings."));
  checks.push(passIf("OVRTX.FIRST_FRAME_SCRIPT.001", firstFrameScript.includes("RendererConfig") && firstFrameScript.includes("LdrColor") && firstFrameScript.includes("OVRTX_SKIP_USD_CHECK"), "first-frame smoke script uses ovrtx RendererConfig and LdrColor."));
  checks.push(passIf("OVSTREAM.SMOKE_SERVER.001", ovstreamScript.includes("ovstream.Server") && ovstreamScript.includes("VideoFrame.from_cuda_array") && ovstreamScript.includes("/healthz") && ovstreamScript.includes("BGRA"), "ovstream smoke server starts WebRTC, gates /healthz, and submits BGRA CUDA frames."));
  checks.push(passIf("OVSTREAM.BROWSER_CLIENT_DEP.001", browserPackage.includes("\"@nvidia/ov-web-rtc\""), "browser client depends on NVIDIA @nvidia/ov-web-rtc."));
  checks.push(passIf("OVSTREAM.BROWSER_CLIENT_PROBE_DEP.001", browserPackage.includes("\"playwright\"") && browserPackage.includes("\"probe:first-frame\""), "browser client includes a Playwright first-frame probe script."));
  checks.push(passIf("OVSTREAM.BROWSER_CLIENT_DIRECT.001", browserMain.includes("StreamType.DIRECT") && browserMain.includes("server:") && browserMain.includes("signalingPort:"), "browser client uses ov-web-rtc Direct config."));
  checks.push(passIf("OVSTREAM.BROWSER_CLIENT_VIDEO_ONLY.001", browserHtml.includes('id="remote-video"') && !/three|webgl|babylon|model-viewer/i.test(`${browserHtml}\n${browserMain}`), "browser client exposes an HTML video surface and contains no browser-side 3D renderer."));
  checks.push(passIf("OVSTREAM.BROWSER_FIRST_FRAME_PROBE.001", browserProbe.includes("document.body.dataset.firstVideoFrame") && browserProbe.includes("video.videoWidth") && browserProbe.includes("page.screenshot"), "browser probe waits for nonzero HTML video dimensions and saves screenshot evidence."));
  checks.push(passIf("USD.CHECKER_REPORT.001", /Success!|not available/i.test(usdcheckerReport), "usdchecker report is present and records success or an explicit not-run reason."));
  checks.push(passIf("PREFLIGHT.OVSTREAM_GATE.001", preflight.gates.some((gate) => gate.id === "OMNIVERSE.OVSTREAM.001"), "runtime preflight includes OMNIVERSE.OVSTREAM.001."));
  checks.push(passIf("PREFLIGHT.STREAMING_SUMMARY.001", typeof preflight.summary.omniverse_streaming_ready === "boolean", `omniverse_streaming_ready=${preflight.summary.omniverse_streaming_ready}`));
  checks.push(passIf("VIEWER.CONTRACT_SURFACE.001", viewerContract.transport.browser_surface === "video_stream_only" && viewerContract.browser_client_contract.allowed_render_surface.includes("HTML video"), "viewer contract requires HTML video / ovstream surface."));
  checks.push(passIf("VIEWER.FORBIDDEN_RENDERERS.001", ["WebGL", "Three.js", "Babylon.js"].every((name) => viewerContract.browser_client_contract.forbidden_renderers.includes(name)), `forbidden=${viewerContract.browser_client_contract.forbidden_renderers.join(",")}`));
  checks.push(passIf("VIEWER.OVSTREAM_GATE.001", viewerContract.runtime_gates.some((gate) => gate.id === "OMNIVERSE.OVSTREAM.001"), "viewer contract includes OMNIVERSE.OVSTREAM.001 gate."));

  return {
    package_dir: packageDir,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks
  };
}

async function validateHandoffFiles(packageDir: string, handoff: NvidiaHandoffManifest): Promise<PackageValidationCheck[]> {
  return Promise.all(
    handoff.files.map(async (entry) => {
      const filePath = join(packageDir, entry.path);
      try {
        const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const ok = info.size === entry.size_bytes && sha256 === entry.sha256;
        return passIf(
          `HANDOFF.FILE.${entry.path}`,
          ok,
          ok ? `${entry.path} size and sha256 match.` : `${entry.path} expected ${entry.size_bytes}/${entry.sha256}, got ${info.size}/${sha256}.`
        );
      } catch (error) {
        return passIf(`HANDOFF.FILE.${entry.path}`, false, error instanceof Error ? error.message : String(error));
      }
    })
  );
}

function passIf(id: string, condition: boolean, evidence: string): PackageValidationCheck {
  return { id, status: condition ? "passed" : "failed", evidence };
}

function countMatches(value: string, token: string): number {
  return value.split(token).length - 1;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
