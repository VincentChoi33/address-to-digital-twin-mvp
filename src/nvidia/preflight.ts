import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceManifest, TwinProject } from "../types/twin";
import type { LocalRuntimeProbe } from "./usd";

export type GateStatus = "passed" | "blocked" | "warning" | "not_run";

export interface RuntimeCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface RuntimeCommandRunner {
  run(command: string, args?: string[]): RuntimeCommandResult;
  exists(path: string): boolean;
  env(name: string): string | undefined;
}

export interface RuntimeGate {
  id: string;
  product: string;
  status: GateStatus;
  required_for: string[];
  evidence: string;
  remediation?: string;
}

export interface NvidiaRuntimePreflightReport {
  project_id: string;
  generated_at: string;
  status: "openusd_ready" | "nvidia_runtime_ready" | "blocked";
  summary: {
    openusd_authoring_ready: boolean;
    omniverse_rtx_ready: boolean;
    simready_automation_ready: boolean;
    content_agents_ready: boolean;
  };
  commands: Record<string, { ok: boolean; code: number | null; stdout: string; stderr: string }>;
  gates: RuntimeGate[];
  redacted_environment: Record<string, "present" | "missing">;
  next_actions: string[];
}

export function createNodeRuntimeRunner(): RuntimeCommandRunner {
  return {
    run(command: string, args: string[] = []): RuntimeCommandResult {
      const result = spawnSync(command, args, { encoding: "utf8" });
      return {
        ok: result.status === 0,
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
        code: result.status
      };
    },
    exists(path: string): boolean {
      return existsSync(path);
    },
    env(name: string): string | undefined {
      return process.env[name];
    }
  };
}

export function runNvidiaRuntimePreflight(
  twin: TwinProject,
  manifest: SourceManifest,
  runner: RuntimeCommandRunner = createNodeRuntimeRunner()
): NvidiaRuntimePreflightReport {
  const commands = {
    nvidia_smi: runner.run("nvidia-smi", ["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"]),
    docker_version: runner.run("docker", ["--version"]),
    docker_info: runner.run("docker", ["info", "--format", "{{json .Runtimes}}"]),
    python_pxr: runner.run("python3", ["-c", "from pxr import Usd; print('pxr-usd-ok')"]),
    usdchecker: runner.run("usdchecker", ["--help"]),
    ovrtx: runner.run("ovrtx", ["--help"]),
    kit: runner.run("kit", ["--help"]),
    usdview: runner.run("usdview", ["--help"])
  };

  const envState = redactEnv(runner, [
    "NVIDIA_API_KEY",
    "NGC_API_KEY",
    "NVCF_API_KEY",
    "CONTENT_AGENTS_TOKEN",
    "CONTENT_AGENTS_MATERIAL_BASE_URL",
    "CONTENT_AGENTS_PHYSICS_BASE_URL",
    "CONTENT_AGENTS_TEXTURE_BASE_URL",
    "CONTENT_AGENTS_OVRTX_BASE_URL"
  ]);

  const hasNvidiaGpu = commands.nvidia_smi.ok;
  const dockerInstalled = commands.docker_version.ok;
  const dockerDaemonReady = commands.docker_info.ok;
  const dockerHasNvidiaRuntime = /nvidia/i.test(commands.docker_info.stdout) || /nvidia/i.test(commands.docker_info.stderr);
  const hasUsdRuntime = commands.python_pxr.ok || commands.usdchecker.ok;
  const hasUsdChecker = commands.usdchecker.ok;
  const hasViewerRuntime = commands.ovrtx.ok || commands.kit.ok || commands.usdview.ok || knownOmniversePathExists(runner);
  const hasContentAgentAuth = envState.NVIDIA_API_KEY === "present" || envState.NGC_API_KEY === "present" || envState.NVCF_API_KEY === "present";
  const hasProvidedContentAgentEndpoints =
    envState.CONTENT_AGENTS_MATERIAL_BASE_URL === "present" &&
    envState.CONTENT_AGENTS_PHYSICS_BASE_URL === "present" &&
    envState.CONTENT_AGENTS_OVRTX_BASE_URL === "present";
  const contentAgentsReady =
    hasProvidedContentAgentEndpoints || (hasNvidiaGpu && dockerInstalled && dockerDaemonReady && dockerHasNvidiaRuntime && hasContentAgentAuth);

  const gates: RuntimeGate[] = [
    {
      id: "OPENUSD.AUTHORING.001",
      product: "OpenUSD",
      status: "passed",
      required_for: ["static USD package generation"],
      evidence: "The repository authors a meter-based Y-up .usda package from twin.json/source_manifest.json.",
    },
    {
      id: "OPENUSD.RUNTIME.001",
      product: "OpenUSD / USD Python / usdchecker",
      status: hasUsdRuntime ? "passed" : "blocked",
      required_for: ["local USD validation", "Omniverse preflight"],
      evidence: hasUsdRuntime ? summarizeOk([commands.python_pxr, commands.usdchecker]) : "Neither python3 pxr nor usdchecker is available.",
      remediation: hasUsdRuntime ? undefined : "Install OpenUSD tools or run validation inside an Omniverse/Kit environment."
    },
    {
      id: "OPENUSD.CHECKER.001",
      product: "usdchecker",
      status: hasUsdChecker ? "passed" : "warning",
      required_for: ["CI-grade USD syntax/validator smoke"],
      evidence: hasUsdChecker ? "usdchecker is available on PATH." : "usdchecker is missing; export still works but local USD validation cannot run.",
      remediation: hasUsdChecker ? undefined : "Install usdchecker/OpenUSD CLI tools or use Omniverse Kit validation."
    },
    {
      id: "NVIDIA.GPU.001",
      product: "NVIDIA GPU / Driver",
      status: hasNvidiaGpu ? "passed" : "blocked",
      required_for: ["RTX rendering", "ovrtx", "local Content Agents", "GPU simulation services"],
      evidence: hasNvidiaGpu ? firstLine(commands.nvidia_smi.stdout) : "nvidia-smi is not available or returned non-zero.",
      remediation: hasNvidiaGpu ? undefined : "Run this package on an NVIDIA workstation, cloud GPU VM, or container host with NVIDIA drivers."
    },
    {
      id: "DOCKER.001",
      product: "Docker",
      status: dockerInstalled ? "passed" : "blocked",
      required_for: ["local Omniverse Content Agents", "containerized ovrtx services"],
      evidence: dockerInstalled ? commands.docker_version.stdout || "docker --version returned 0." : "docker CLI is missing.",
      remediation: dockerInstalled ? undefined : "Install Docker."
    },
    {
      id: "DOCKER.DAEMON.001",
      product: "Docker daemon",
      status: dockerDaemonReady ? "passed" : dockerInstalled ? "blocked" : "not_run",
      required_for: ["local Omniverse Content Agents"],
      evidence: dockerDaemonReady ? "docker info returned runtime metadata." : dockerInstalled ? safeText(commands.docker_info.stderr || commands.docker_info.stdout) : "Docker CLI missing; daemon check skipped.",
      remediation: dockerDaemonReady ? undefined : "Start Docker Desktop/daemon and re-run preflight."
    },
    {
      id: "DOCKER.NVIDIA_RUNTIME.001",
      product: "NVIDIA Container Toolkit",
      status: dockerHasNvidiaRuntime ? "passed" : hasNvidiaGpu && dockerDaemonReady ? "blocked" : "not_run",
      required_for: ["GPU-enabled Content Agents containers"],
      evidence: dockerHasNvidiaRuntime ? "Docker runtime metadata includes nvidia." : "Docker runtime metadata did not expose an nvidia runtime.",
      remediation: dockerHasNvidiaRuntime ? undefined : "Install/configure NVIDIA Container Toolkit on the GPU host."
    },
    {
      id: "OMNIVERSE.VIEWER.001",
      product: "NVIDIA Omniverse / ovrtx / Kit viewer",
      status: hasViewerRuntime && hasNvidiaGpu ? "passed" : hasViewerRuntime ? "warning" : "blocked",
      required_for: ["NVIDIA-only visual runtime", "RTX/ovrtx render verification"],
      evidence: hasViewerRuntime ? "Found at least one viewer/runtime command or known Omniverse app path." : "No ovrtx, kit, usdview, or known Omniverse app path was found.",
      remediation: hasViewerRuntime && hasNvidiaGpu ? undefined : "Install/use an Omniverse Kit or ovrtx runtime on an NVIDIA GPU machine."
    },
    {
      id: "CONTENT_AGENTS.AUTH.001",
      product: "NVIDIA API / NGC / NVCF credentials",
      status: hasContentAgentAuth || hasProvidedContentAgentEndpoints ? "passed" : "blocked",
      required_for: ["Omniverse Content Agents material/physics assignment"],
      evidence: hasContentAgentAuth
        ? "A required NVIDIA/NGC/NVCF auth variable is present (redacted)."
        : hasProvidedContentAgentEndpoints
          ? "Provided Content Agents endpoints are present; auth may be endpoint-managed."
          : "No NVIDIA_API_KEY, NGC_API_KEY, NVCF_API_KEY, or complete provided Content Agents endpoint set was found.",
      remediation: hasContentAgentAuth || hasProvidedContentAgentEndpoints ? undefined : "Provide NVIDIA_API_KEY for local deployment or set provided Content Agents endpoint URLs/tokens."
    },
    {
      id: "CONTENT_AGENTS.RUNTIME.001",
      product: "Omniverse Content Agents",
      status: contentAgentsReady ? "passed" : "blocked",
      required_for: ["full SimReady material/physics assignment"],
      evidence: contentAgentsReady
        ? "Content Agents prerequisites are present through provided endpoints or local GPU/Docker/auth."
        : "Content Agents prerequisites are incomplete.",
      remediation: contentAgentsReady ? undefined : "Satisfy NVIDIA GPU + Docker daemon + NVIDIA runtime + auth, or provide healthy service endpoints."
    }
  ];

  const openusdReady = gates.find((gate) => gate.id === "OPENUSD.AUTHORING.001")?.status === "passed" && hasUsdRuntime;
  const omniverseReady = hasNvidiaGpu && hasViewerRuntime;
  const simreadyAutomationReady = contentAgentsReady && hasUsdRuntime;
  const status = omniverseReady && simreadyAutomationReady ? "nvidia_runtime_ready" : openusdReady ? "openusd_ready" : "blocked";

  return {
    project_id: twin.project_id,
    generated_at: manifest.generated_at || twin.created_at || new Date().toISOString(),
    status,
    summary: {
      openusd_authoring_ready: openusdReady,
      omniverse_rtx_ready: omniverseReady,
      simready_automation_ready: simreadyAutomationReady,
      content_agents_ready: contentAgentsReady
    },
    commands: Object.fromEntries(Object.entries(commands).map(([key, value]) => [key, compactCommand(value)])),
    gates,
    redacted_environment: envState,
    next_actions: buildNextActions({ hasNvidiaGpu, hasViewerRuntime, hasUsdRuntime, contentAgentsReady, hasUsdChecker })
  };
}

export function runtimeProbeFromPreflight(report: NvidiaRuntimePreflightReport): LocalRuntimeProbe {
  return {
    nvidiaSmi: report.gates.find((gate) => gate.id === "NVIDIA.GPU.001")?.status === "passed" ? "available" : "missing",
    docker: report.gates.find((gate) => gate.id === "DOCKER.001")?.status === "passed" ? "available" : "missing",
    usdPython: report.commands.python_pxr?.ok ? "available" : "missing",
    usdChecker: report.commands.usdchecker?.ok ? "available" : "missing",
    note:
      report.status === "nvidia_runtime_ready"
        ? "NVIDIA runtime preflight passed for local Omniverse/SimReady automation prerequisites."
        : report.status === "openusd_ready"
          ? "OpenUSD authoring/validation is ready locally, but full NVIDIA RTX/SimReady runtime gates remain unresolved."
          : "NVIDIA runtime preflight is blocked; inspect nvidia_runtime_preflight.json for gate-level remediation."
  };
}

export async function writeNvidiaRuntimePreflight(
  outDir: string,
  report: NvidiaRuntimePreflightReport
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "nvidia_runtime_preflight.json");
  const markdownPath = join(outDir, "nvidia_runtime_preflight.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderPreflightMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

export function renderPreflightMarkdown(report: NvidiaRuntimePreflightReport): string {
  const rows = report.gates
    .map((gate) => `| ${gate.id} | ${gate.product} | ${gate.status} | ${gate.evidence.replace(/\|/g, "\\|")} | ${gate.remediation ?? "-"} |`)
    .join("\n");
  const actions = report.next_actions.map((action) => `- ${action}`).join("\n");
  return `# NVIDIA Runtime Preflight — ${report.project_id}\n\nStatus: **${report.status}**\n\n## Summary\n\n- OpenUSD authoring ready: ${report.summary.openusd_authoring_ready}\n- Omniverse RTX ready: ${report.summary.omniverse_rtx_ready}\n- SimReady automation ready: ${report.summary.simready_automation_ready}\n- Content Agents ready: ${report.summary.content_agents_ready}\n\n## Gates\n\n| Gate | Product | Status | Evidence | Remediation |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Next actions\n\n${actions}\n`;
}

function redactEnv(runner: RuntimeCommandRunner, keys: string[]): Record<string, "present" | "missing"> {
  return Object.fromEntries(keys.map((key) => [key, runner.env(key) ? "present" : "missing"]));
}

function knownOmniversePathExists(runner: RuntimeCommandRunner): boolean {
  return [
    "/Applications/Omniverse.app",
    "/Applications/NVIDIA Omniverse.app",
    "/opt/nvidia/omniverse",
    "/usr/local/bin/ovrtx"
  ].some((path) => runner.exists(path));
}

function compactCommand(result: RuntimeCommandResult): { ok: boolean; code: number | null; stdout: string; stderr: string } {
  return {
    ok: result.ok,
    code: result.code,
    stdout: safeText(result.stdout),
    stderr: safeText(result.stderr)
  };
}

function safeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "command returned success";
}

function summarizeOk(results: RuntimeCommandResult[]): string {
  const ok = results.filter((result) => result.ok).map((result) => firstLine(result.stdout || result.stderr));
  return ok.length > 0 ? ok.join("; ") : "at least one runtime command returned success";
}

function buildNextActions(input: {
  hasNvidiaGpu: boolean;
  hasViewerRuntime: boolean;
  hasUsdRuntime: boolean;
  contentAgentsReady: boolean;
  hasUsdChecker: boolean;
}): string[] {
  const actions: string[] = [];
  if (!input.hasUsdRuntime) actions.push("Install OpenUSD/usdchecker or run validation inside an Omniverse Kit environment.");
  if (!input.hasNvidiaGpu) actions.push("Move the package to an NVIDIA GPU workstation/cloud VM for RTX/ovrtx rendering.");
  if (!input.hasViewerRuntime) actions.push("Install or expose NVIDIA Omniverse Kit/ovrtx/usdview runtime for the USD stage.");
  if (!input.contentAgentsReady) actions.push("Configure Content Agents prerequisites: NVIDIA API/NGC/NVCF auth plus GPU Docker runtime, or provided service endpoints.");
  if (input.hasUsdChecker) actions.push("Run usdchecker on every exported .usda in CI and keep validator reports with the package.");
  actions.push("After runtime gates pass, run SimReady/Asset Validator and USD Performance Tuning baseline profiling.");
  return actions;
}
