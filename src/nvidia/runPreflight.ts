import { join } from "node:path";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../types/twin";
import { createNodeRuntimeRunner, runNvidiaRuntimePreflight, writeNvidiaRuntimePreflight } from "./preflight";

async function main(): Promise<void> {
  const twin = sadangTwin as unknown as TwinProject;
  const manifest = sadangManifest as unknown as SourceManifest;
  const outDir = join(process.cwd(), "src/samples/sadang_317_6/omniverse");
  const report = runNvidiaRuntimePreflight(twin, manifest, createNodeRuntimeRunner());
  const paths = await writeNvidiaRuntimePreflight(outDir, report);
  console.log(JSON.stringify({ status: report.status, summary: report.summary, ...paths }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
