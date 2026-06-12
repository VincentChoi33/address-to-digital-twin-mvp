import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../types/twin";
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

  await mkdir(outDir, { recursive: true });
  await writeFile(usdPath, exported.usda, "utf8");

  const checkerResult = runtimeProbe.usdChecker === "available" ? spawnSync("usdchecker", [usdPath], { encoding: "utf8" }) : null;
  const checkerStatus = checkerResult ? (checkerResult.status === 0 ? "passed" : "failed") : "not_run";
  const checkerText = checkerResult
    ? `${checkerResult.stdout ?? ""}${checkerResult.stderr ?? ""}`
    : "usdchecker was not available on PATH; validation was not run in this environment.\n";
  await writeFile(join(outDir, "usdchecker_report.txt"), checkerText, "utf8");

  const stackManifest = exported.stackManifest as {
    local_validation?: object;
  };
  stackManifest.local_validation = {
    command: `usdchecker ${twin.project_id}.usda`,
    status: checkerStatus,
    report: "usdchecker_report.txt"
  };
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
