/**
 * The in-place database restore's refusals and failures, with the container
 * lookup, the disk probe and the snapshot stream faked: each one must stop the
 * restore with its reason instead of recording a restore that wrote nothing.
 *
 *   - a mongorestore that exits 0 having restored 0 documents (or failed
 *     some) is a failed restore, not a success.
 *   - the refusals (target not running, no restore client, a known disk
 *     shortfall) are typed RestoreRefusedError, before any destructive work
 *     starts.
 */
import { Docker } from "@otterdeploy/docker";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExecResult } from "../exec";
import type { DatabaseTarget } from "../restore-target";

import { RestoreRefusedError } from "../restore-errors";
import { RusticCli } from "../rustic";

const fake: {
  containerId: string | null;
  dfStdout: string;
  stream: { exitCode: number; stderr: string };
  streamed: number;
} = { containerId: "c1", dfStdout: "", stream: { exitCode: 0, stderr: "" }, streamed: 0 };

vi.mock("../exec", () => ({
  findResourceContainerId: async () => fake.containerId,
  execCapture: async (): Promise<ExecResult> => ({
    exitCode: 0,
    stdout: fake.dfStdout,
    stderr: "",
  }),
}));

vi.mock("../restore-stream", () => ({
  streamSnapshotIntoExec: async () => {
    fake.streamed += 1;
    return fake.stream;
  },
}));

const { restoreDatabaseInPlace } = await import("../restore-in-place");

const MB = 1024 * 1024;

/** `df -Pk` output whose last line reports `availableKb` free. */
function dfOutput(availableKb: number): string {
  return [
    "Filesystem     1024-blocks    Used Available Capacity Mounted on",
    `/dev/sda1         20000000 1000000 ${availableKb}  5% /data/db`,
  ].join("\n");
}

function createTarget(engine: DatabaseTarget["engine"]): DatabaseTarget {
  return {
    resourceId: createId(ID_PREFIX.resource),
    resourceName: "orders",
    projectSlug: "shop",
    engine,
    databaseName: "orders",
    username: "app",
    password: "secret",
    serviceName: "otterdeploy-shop-orders",
  };
}

const docker = new Docker({ timeoutMs: 1 });
const cli = new RusticCli({
  repository: "/nonexistent/otterdeploy-restore-in-place",
  options: {},
  repoId: "otterdeploy-backups/res_test",
  passwordDomain: "otterdeploy-backups/res_test",
});
/** pg_restore --clean --if-exists into a database that still holds a
 *  partitioned table with a primary key (pg_restore from postgres:17). */
const INHERITED_DROP_STDERR = [
  'pg_restore: error: could not execute query: ERROR:  cannot drop inherited constraint "zoo_part_rest_pkey" of relation "zoo_part_rest"',
  "Command was: ALTER TABLE IF EXISTS ONLY public.zoo_part_rest DROP CONSTRAINT IF EXISTS zoo_part_rest_pkey;",
  'pg_restore: error: could not execute query: ERROR:  cannot drop inherited constraint "zoo_part_eu_pkey" of relation "zoo_part_eu"',
  "Command was: ALTER TABLE IF EXISTS ONLY public.zoo_part_eu DROP CONSTRAINT IF EXISTS zoo_part_eu_pkey;",
  "pg_restore: warning: errors ignored on restore: 2",
  "",
].join("\n");
const snapshot = { id: "snap1", sourceDatabaseName: "orders", sourceSizeBytes: 10 * MB };

beforeEach(() => {
  fake.containerId = "c1";
  fake.dfStdout = dfOutput(10_000_000);
  fake.stream = { exitCode: 0, stderr: "" };
  fake.streamed = 0;
});

describe("restoreDatabaseInPlace", () => {
  it("refuses a target whose container is not running, naming it", async () => {
    fake.containerId = null;
    const restore = restoreDatabaseInPlace(docker, createTarget("postgres"), cli, snapshot);
    await expect(restore).rejects.toBeInstanceOf(RestoreRefusedError);
    await expect(restore).rejects.toThrow(/otterdeploy-shop-orders is not running/);
    expect(fake.streamed).toBe(0);
  });

  it("refuses an engine with no restore client before streaming anything", async () => {
    const restore = restoreDatabaseInPlace(docker, createTarget("redis"), cli, snapshot);
    await expect(restore).rejects.toBeInstanceOf(RestoreRefusedError);
    await expect(restore).rejects.toThrow(/redis has no dump restore/);
    expect(fake.streamed).toBe(0);
  });

  it("refuses a known disk shortfall before the destructive part starts", async () => {
    fake.dfStdout = dfOutput(1024);
    const restore = restoreDatabaseInPlace(docker, createTarget("mongodb"), cli, snapshot);
    await expect(restore).rejects.toBeInstanceOf(RestoreRefusedError);
    await expect(restore).rejects.toThrow(/not enough disk space for the restore/);
    expect(fake.streamed).toBe(0);
  });

  it("fails when the restore client exits non-zero, with its exit code", async () => {
    fake.stream = { exitCode: 1, stderr: "pg_restore: error: could not connect" };
    const restore = restoreDatabaseInPlace(docker, createTarget("postgres"), cli, snapshot);
    await expect(restore).rejects.toThrow(
      /failed \(exit 1\): pg_restore: error: could not connect/,
    );
  });

  it("restores a Postgres with a partitioned table over itself: the inherited drops are forgiven", async () => {
    fake.stream = { exitCode: 1, stderr: INHERITED_DROP_STDERR };
    await expect(
      restoreDatabaseInPlace(docker, createTarget("postgres"), cli, snapshot),
    ).resolves.toEqual({ ok: true });
  });

  it("still fails a pg_restore whose errors include anything beyond those drops", async () => {
    fake.stream = {
      exitCode: 1,
      stderr: INHERITED_DROP_STDERR.replace(
        "pg_restore: warning: errors ignored on restore: 2",
        'pg_restore: error: could not execute query: ERROR:  relation "t" already exists\nCommand was: CREATE TABLE public.t (id integer);\npg_restore: warning: errors ignored on restore: 3',
      ),
    };
    await expect(
      restoreDatabaseInPlace(docker, createTarget("postgres"), cli, snapshot),
    ).rejects.toThrow(/failed \(exit 1\)/);
  });

  it("fails a mongorestore that exits 0 having restored 0 documents", async () => {
    fake.stream = {
      exitCode: 0,
      stderr: "0 document(s) restored successfully. 0 document(s) failed to restore.",
    };
    const restore = restoreDatabaseInPlace(docker, createTarget("mongodb"), cli, snapshot);
    await expect(restore).rejects.toThrow(/did not restore the snapshot: mongorestore restored 0/);
  });

  it("fails a mongorestore that exits 0 but failed some documents", async () => {
    fake.stream = {
      exitCode: 0,
      stderr: "40 document(s) restored successfully. 2 document(s) failed to restore.",
    };
    const restore = restoreDatabaseInPlace(docker, createTarget("mongodb"), cli, snapshot);
    await expect(restore).rejects.toThrow(/failed to restore 2 document/);
  });

  it("succeeds when the documents landed", async () => {
    fake.stream = {
      exitCode: 0,
      stderr: "42 document(s) restored successfully. 0 document(s) failed to restore.",
    };
    await expect(
      restoreDatabaseInPlace(docker, createTarget("mongodb"), cli, snapshot),
    ).resolves.toEqual({ ok: true });
    expect(fake.streamed).toBe(1);
  });
});
