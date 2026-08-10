import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

// `vi.mock` is hoisted above const declarations, so the fn has to be created
// inside `vi.hoisted` or the factory closes over a TDZ binding.
const { runOnHost } = vi.hoisted(() => ({ runOnHost: vi.fn() }));
vi.mock("../../../system-health/host-run", () => ({ runOnHost }));

import { zfsDriver } from "../zfs";

/**
 * `runOnHost` executes as root in the host's namespaces, so these assert two
 * things the rest of the suite cannot: that the commands are ordered such that
 * ZFS will accept them, and that nothing reaches that shell unvalidated.
 */

const ok = { isOk: () => true, isErr: () => false, value: { exitCode: 0, output: "" } };
const script = () => runOnHost.mock.calls.map((c) => String(c[0])).join("\n---\n");

// The driver reads BRANCH_ZFS_POOL raw off process.env by design (keeping full
// env validation out of the deploy import graph), so the test has to set it the
// same way. Scoped to this file.
// oxlint-disable-next-line node/no-process-env -- the driver reads this var raw by design; the test must set it the same way
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  runOnHost.mockReset();
  runOnHost.mockResolvedValue(ok);
  env.BRANCH_ZFS_POOL = "otterdeploy";
});

describe("zfs branch", () => {
  it("snapshots then clones, under the installer's dataset", async () => {
    await zfsDriver.branch({
      sourceVolume: "pgdata-app",
      targetVolume: "pgdata-app-pr-7",
      engine: "postgres",
    });
    const s = script();
    expect(s).toContain("zfs snapshot otterdeploy/pg/pgdata-app@pgdata-app-pr-7");
    expect(s).toContain("zfs clone");
    expect(s.indexOf("zfs snapshot")).toBeLessThan(s.indexOf("zfs clone"));
  });

  it("returns the snapshot ref so teardown does not have to recompute it", async () => {
    const result = await zfsDriver.branch({
      sourceVolume: "pgdata-app",
      targetVolume: "pgdata-app-pr-7",
      engine: "postgres",
    });
    expect(result.snapshotRef).toBe("otterdeploy/pg/pgdata-app@pgdata-app-pr-7");
  });

  it("clears a stale snapshot first so a retry after a failure succeeds", async () => {
    await zfsDriver.branch({ sourceVolume: "a", targetVolume: "b", engine: "postgres" });
    expect(script()).toContain("zfs destroy otterdeploy/pg/a@b 2>/dev/null || true");
  });

  it("never recurses: -r would reach datasets we did not create", async () => {
    await zfsDriver.branch({ sourceVolume: "a", targetVolume: "b", engine: "postgres" });
    expect(script()).not.toMatch(/zfs destroy\s+-r/);
  });
});

describe("zfs destroy", () => {
  it("destroys the CLONE before the SNAPSHOT", async () => {
    // The reverse order fails on the first call: ZFS refuses to destroy a
    // snapshot while a clone depends on it.
    await zfsDriver.destroy({
      targetVolume: "pgdata-app-pr-7",
      snapshotRef: "otterdeploy/pg/pgdata-app@pgdata-app-pr-7",
    });
    const s = script();
    expect(s.indexOf("otterdeploy/pg/pgdata-app-pr-7")).toBeLessThan(
      s.indexOf("otterdeploy/pg/pgdata-app@pgdata-app-pr-7"),
    );
  });

  it("tolerates either object already being gone", async () => {
    // A teardown that died between the two steps must complete on re-run, not
    // error on the clone it already removed.
    await zfsDriver.destroy({ targetVolume: "b", snapshotRef: "otterdeploy/pg/a@b" });
    for (const line of script()
      .split("\n")
      .filter((l) => l.includes("zfs destroy"))) {
      expect(line).toContain("|| true");
    }
  });

  it("never promotes", async () => {
    // Promotion would make an ephemeral preview the origin holder of
    // production's blocks, inverting the lifetime relationship.
    await zfsDriver.destroy({ targetVolume: "b", snapshotRef: "otterdeploy/pg/a@b" });
    expect(script()).not.toContain("zfs promote");
  });
});

describe("shell safety", () => {
  it("refuses a volume name outside the allowlist", async () => {
    // This value reaches a root shell on the host.
    await expect(
      zfsDriver.branch({
        sourceVolume: "a; rm -rf /",
        targetVolume: "b",
        engine: "postgres",
      }),
    ).rejects.toThrow();
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it("refuses command substitution and globs", async () => {
    for (const bad of ["$(id)", "`id`", "a b", "../escape", "a|b"]) {
      await expect(
        zfsDriver.branch({ sourceVolume: bad, targetVolume: "b", engine: "postgres" }),
      ).rejects.toThrow();
    }
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it("refuses to run at all when no pool is configured", async () => {
    delete env.BRANCH_ZFS_POOL;
    await expect(
      zfsDriver.branch({ sourceVolume: "a", targetVolume: "b", engine: "postgres" }),
    ).rejects.toThrow();
    expect(runOnHost).not.toHaveBeenCalled();
  });
});
