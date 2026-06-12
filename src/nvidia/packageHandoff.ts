import { join } from "node:path";
import sadangManifest from "../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../types/twin";
import { writeNvidiaHandoffPackage } from "./handoff";

async function main(): Promise<void> {
  const twin = sadangTwin as unknown as TwinProject;
  const manifest = sadangManifest as unknown as SourceManifest;
  const packageDir = join(process.cwd(), "src/samples/sadang_317_6/omniverse");
  const result = await writeNvidiaHandoffPackage({ packageDir, twin, sourceManifest: manifest });
  console.log(
    JSON.stringify(
      {
        manifestPath: result.manifestPath,
        runbookPath: result.runbookPath,
        status: result.manifest.status,
        files: result.manifest.files.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
