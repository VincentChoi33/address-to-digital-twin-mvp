import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOverpassContext, getOvertureFutureConnector } from "./dataConnectors";
import { generateStaticPreviewHtml } from "./exportStaticHtml";
import { geocodeAddress } from "./geocode";
import { generateMassing } from "./generateMassing";
import { buildSourceManifest } from "./manifest";
import { projectIdFromQuery } from "./previewTwin";
import { generateQaReport } from "./qa";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");

interface RunOptions {
  projectId: string;
  rawQuery: string;
  outputDir: string;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const sample = args.includes("--sample") ? args[args.indexOf("--sample") + 1] : undefined;
  const queryIndex = args.indexOf("--address");
  const address = queryIndex >= 0 ? args[queryIndex + 1] : undefined;
  const projectIndex = args.indexOf("--project-id");
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : undefined;

  if (sample === "sadang" || !address) {
    return {
      projectId: projectId ?? "sadang_317_6",
      rawQuery: address ?? "사당동 317-6번지 디지털 트윈 만들어줘",
      outputDir: resolve(projectRoot, "src/samples/sadang_317_6")
    };
  }

  const safeProjectId = projectId ?? projectIdFromQuery(address);

  return {
    projectId: safeProjectId || "address_twin_preview",
    rawQuery: address,
    outputDir: resolve(projectRoot, "src/samples", safeProjectId || "address_twin_preview")
  };
}

export async function runAddressTwin(options: RunOptions) {
  await mkdir(options.outputDir, { recursive: true });

  const geocoding = await geocodeAddress(options.rawQuery);
  const [lon, lat] = geocoding.selected.selected_lon_lat;
  const context = await fetchOverpassContext({ lat, lon });
  const twin = generateMassing({
    projectId: options.projectId,
    rawQuery: options.rawQuery,
    center: { lat, lon },
    geocoding,
    context
  });

  twin.geocoding.notes.push(...context.notes, getOvertureFutureConnector().note);

  const manifest = buildSourceManifest(twin);
  const qaReport = generateQaReport(twin, manifest);
  const preview = generateStaticPreviewHtml(twin, manifest);

  const twinPath = resolve(options.outputDir, "twin.json");
  const manifestPath = resolve(options.outputDir, "source_manifest.json");
  const qaPath = resolve(options.outputDir, "qa_report.html");
  const previewPath = resolve(options.outputDir, "preview.html");

  await Promise.all([
    writeFile(twinPath, `${JSON.stringify(twin, null, 2)}\n`, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(qaPath, qaReport, "utf8"),
    writeFile(previewPath, preview, "utf8")
  ]);

  return {
    twin,
    manifest,
    paths: {
      twinPath,
      manifestPath,
      qaPath,
      previewPath
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAddressTwin(parseArgs());
  const confidence = result.manifest.geocoding.confidence;
  console.log("Address-to-Digital-Twin preview generated.");
  console.log(`Project: ${result.twin.project_id}`);
  console.log(`Geocoding provider: ${result.manifest.geocoding.provider}`);
  console.log(`Confidence: ${confidence.toUpperCase()} - preview/approximate until official data is connected.`);
  console.log(`twin.json: ${result.paths.twinPath}`);
  console.log(`source_manifest.json: ${result.paths.manifestPath}`);
  console.log(`qa_report.html: ${result.paths.qaPath}`);
  console.log(`preview.html: ${result.paths.previewPath}`);
}
