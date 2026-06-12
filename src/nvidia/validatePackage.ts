import { join } from "node:path";
import { validateNvidiaPackage } from "./packageValidator";

async function main(): Promise<void> {
  const packageDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(process.cwd(), "src/samples/sadang_317_6/omniverse");
  const report = await validateNvidiaPackage(packageDir);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
