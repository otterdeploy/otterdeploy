import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneStaleBuilds } from "../build-workdir";

// od-48w removed `pruneStaleBuildCache` — the per-repo local-dir BuildKit
// cache it swept no longer exists (builds now route through a standalone
// buildkitd with its own persistent cache + GC; see buildx.ts). This file
// keeps a minimal smoke test for the retention sweep that's still live.
describe("pruneStaleBuilds", () => {
  test("no-op when the builds dir doesn't exist — never throws", async () => {
    // pruneStaleBuilds reads DATA_ROOT/builds; in this test env that's
    // guaranteed absent (no data folder configured), so this just asserts
    // the no-op path completes cleanly.
    await pruneStaleBuilds();
    expect(existsSync(join(tmpdir(), "otter-builds-absent-check"))).toBe(false);
  });
});
