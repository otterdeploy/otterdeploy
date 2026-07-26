import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const sourceDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(resolve(sourceDirectory, relativePath), "utf8");
}

describe("raw Docker access boundary", () => {
  test("every daemon endpoint requires the installation principal", () => {
    const router = source("index.ts");
    const handlerCount = router.match(/\.handler\(/g)?.length ?? 0;
    const installGateCount = router.match(/requireInstallAdmin\(\)/g)?.length ?? 0;

    expect(handlerCount).toBeGreaterThan(0);
    expect(installGateCount).toBe(handlerCount);
    expect(router).not.toContain("orgScopedProcedure");
    expect(router).not.toContain("requirePermission(");
  });

  test("the rich host-volume endpoints require the same installation principal", () => {
    const router = source("../volumes/index.ts");
    const handlerCount = router.match(/\.handler\(/g)?.length ?? 0;
    const installGateCount = router.match(/requireInstallAdmin\(\)/g)?.length ?? 0;

    expect(installGateCount).toBe(handlerCount);
    expect(router).not.toContain("orgScopedProcedure");
    expect(router).not.toContain("requirePermission(");
  });

  test("inspect contracts cannot regress to an untyped daemon passthrough", () => {
    expect(source("contract.ts")).not.toContain(".output(z.unknown())");
    expect(source("../volumes/contract.ts")).not.toContain("z.record(z.string(), z.unknown())");
  });
});
