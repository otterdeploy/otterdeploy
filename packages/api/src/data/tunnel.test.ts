import { describe, expect, it } from "vite-plus/test";

import { RELAY_SCRIPT } from "./tunnel";

describe("RELAY_SCRIPT", () => {
  it("is valid POSIX sh (the outer layer runs under the image's /bin/sh)", () => {
    const check = Bun.spawnSync(["sh", "-n"], { stdin: new TextEncoder().encode(RELAY_SCRIPT) });
    expect(new TextDecoder().decode(check.stderr)).toBe("");
    expect(check.exitCode).toBe(0);
  });

  it("is valid bash on the inner layer", () => {
    const inner = RELAY_SCRIPT.split("exec bash -c '")[1]?.split("\n  '")[0] ?? "";
    expect(inner).toContain("wait -n");
    const check = Bun.spawnSync(["bash", "-n"], {
      stdin: new TextEncoder().encode(inner.replaceAll(`'"$p"'`, "5432")),
    });
    expect(new TextDecoder().decode(check.stderr)).toBe("");
    expect(check.exitCode).toBe(0);
  });
});
