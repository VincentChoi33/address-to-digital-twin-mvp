import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { validateNvidiaPackage } from "../packageValidator";

const sampleDir = join(process.cwd(), "src/samples/sadang_317_6/omniverse");

describe("NVIDIA package validator", () => {
  it("passes the committed Sadang NVIDIA package", async () => {
    const report = await validateNvidiaPackage(sampleDir);

    expect(report.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "VIEWER.CONTRACT_SURFACE.001")?.status).toBe("passed");
    expect(report.checks.find((check) => check.id === "PREFLIGHT.OVSTREAM_GATE.001")?.status).toBe("passed");
  });

  it("fails when required package files are absent", async () => {
    const dir = join(tmpdir(), `nvidia-package-empty-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "handoff_manifest.json"), "{}", "utf8");

    await expect(validateNvidiaPackage(dir)).rejects.toThrow();
  });
});
