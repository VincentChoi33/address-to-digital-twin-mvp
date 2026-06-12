import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../types/twin";
import { buildOvrtxCompositeStage } from "./ovrtxComposite";
import { exportTwinToOmniversePackage, type LocalRuntimeProbe } from "./usd";

function hasCommand(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function probeRuntime(): LocalRuntimeProbe {
  const nvidiaSmi = hasCommand("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]) ? "available" : "missing";
  const docker = hasCommand("docker", ["--version"]) ? "available" : "missing";
  const usdPython = spawnSync("python3", ["-c", "from pxr import Usd; print('ok')"], { stdio: "ignore" }).status === 0 ? "available" : "missing";
  const usdChecker = hasCommand("usdchecker", ["--help"]) ? "available" : "missing";
  return {
    nvidiaSmi,
    docker,
    usdPython,
    usdChecker,
    note:
      nvidiaSmi === "available"
        ? "A local NVIDIA GPU was detected. Omniverse/ovrtx, Content Agents, and SimReady validation still require their own setup gates."
        : "No local NVIDIA GPU was detected. This Mac can author OpenUSD deterministically, but RTX/ovrtx rendering and SimReady runtime validation must run on an NVIDIA workstation/container."
  };
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), "src/samples/sadang_317_6/omniverse");
  const twin = sadangTwin as unknown as TwinProject;
  const manifest = sadangManifest as unknown as SourceManifest;
  const runtimeProbe = probeRuntime();
  const exported = exportTwinToOmniversePackage(twin, manifest, runtimeProbe);
  const usdPath = join(outDir, `${twin.project_id}.usda`);
  const composite = buildOvrtxCompositeStage(twin, { sceneFileName: `${twin.project_id}.usda` });
  const compositePath = join(outDir, composite.fileName);

  await mkdir(outDir, { recursive: true });
  await writeFile(usdPath, exported.usda, "utf8");
  await writeFile(compositePath, composite.usda, "utf8");
  await copyFile(join(process.cwd(), "scripts/nvidia_ovrtx_first_frame.py"), join(outDir, "nvidia_ovrtx_first_frame.py"));
  await copyFile(join(process.cwd(), "scripts/nvidia_ovstream_smoke_server.py"), join(outDir, "nvidia_ovstream_smoke_server.py"));

  const checkerResult = runtimeProbe.usdChecker === "available" ? spawnSync("usdchecker", [usdPath], { encoding: "utf8" }) : null;
  const checkerStatus = checkerResult ? (checkerResult.status === 0 ? "passed" : "failed") : "not_run";
  const checkerText = renderUsdCheckerReport(twin.project_id, checkerResult);
  await writeFile(join(outDir, "usdchecker_report.txt"), checkerText, "utf8");

  const stackManifest = exported.stackManifest as {
    local_validation?: object;
  };
  stackManifest.local_validation = {
    command: `usdchecker ${twin.project_id}.usda`,
    status: checkerStatus,
    report: "usdchecker_report.txt"
  };
  Object.assign(stackManifest, {
    ovrtx_viewer_session: {
      composite_stage: composite.fileName,
      render_product_path: composite.renderProductPath,
      camera_path: composite.cameraPath,
      resolution: [composite.width, composite.height],
      first_frame_smoke_script: "nvidia_ovrtx_first_frame.py",
      first_frame_command: `python3 nvidia_ovrtx_first_frame.py --stage ${composite.fileName} --output-json ovrtx_first_frame_report.json --output-ppm ovrtx_first_frame.ppm`,
      ovstream_smoke_script: "nvidia_ovstream_smoke_server.py",
      ovstream_smoke_command: `python3 nvidia_ovstream_smoke_server.py --stage ${composite.fileName} --output-json ovstream_smoke_report.json`
    }
  });
  const report = exported.simreadyReport as {
    checks?: Array<{ id: string; status: string; evidence: string }>;
  };
  const check = report.checks?.find((item) => item.id === "USD.RUNTIME_VALIDATOR.001");
  if (check) {
    check.status = checkerStatus === "not_run" ? "blocked" : checkerStatus;
    check.evidence =
      checkerStatus === "passed"
        ? "Local usdchecker completed with exit code 0; see usdchecker_report.txt."
        : checkerStatus === "failed"
          ? "Local usdchecker failed; see usdchecker_report.txt."
          : "usdchecker was not available on PATH; see usdchecker_report.txt.";
  }

  await writeFile(join(outDir, "nvidia_stack_manifest.json"), `${JSON.stringify(exported.stackManifest, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "simready_minimum_report.json"), `${JSON.stringify(exported.simreadyReport, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "README.md"), exported.readme, "utf8");

  console.log(JSON.stringify({ outDir, ...exported.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function renderUsdCheckerReport(projectId: string, result: ReturnType<typeof spawnSync> | null): string {
  if (!result) {
    return "command: usdchecker " + projectId + ".usda\nstatus: not_run\n\nusdchecker was not available on PATH; validation was not run in this environment.\n";
  }
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const stderrLines = stderr.split(/\r?\n/).filter(Boolean);
  const nonDeterministicWarnings = stderrLines.filter(isUsdShadeDuplicateRegistrationWarning);
  const stableStderr = stderrLines.filter((line) => !isUsdShadeDuplicateRegistrationWarning(line));
  const lines = [
    `command: usdchecker ${projectId}.usda`,
    `exit_status: ${result.status ?? "unknown"}`,
    "",
    "stdout:",
    stdout || "(empty)",
    "",
    "stderr:"
  ];
  if (stableStderr.length > 0) {
    lines.push(stableStderr.join("\n"));
  } else if (nonDeterministicWarnings.length > 0) {
    lines.push("[known local UsdShade duplicate connectable-registration warnings suppressed]");
  } else {
    lines.push("(empty)");
  }
  return `${lines.join("\n")}\n`;
}

function isUsdShadeDuplicateRegistrationWarning(line: string): boolean {
  return line.includes("RegisterBehaviorForPrimTypeId") && line.includes("Connectable behavior already registered");
}
