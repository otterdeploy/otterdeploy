/**
 * The stdin half of `RusticCli.backupStdin`, driven against a stand-in
 * `rustic` (a shell script) so its failure modes are reproducible without a
 * repository:
 *
 *   - rustic picked the previous snapshot as parent and exited 0 without
 *     reading stdin. The unread pipe EPIPEd with no error listener and killed
 *     the server; for a dump small enough to fit the pipe buffer, the run
 *     "succeeded" with the parent's (old) content.
 *   - a dump stream that breaks mid-way must not become a truncated snapshot.
 *
 * The real binary's parent behaviour is pinned by the argv test: `--force`.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { RusticCli, RusticDumpNotStoredError, buildBackupStdinArgs } from "../rustic";

let dir = "";

/** A fake rustic: `-P <profile> <subcommand> …`. `backup` behaviour is the
 *  script body; every other subcommand succeeds silently. */
async function fakeRustic(name: string, backupBody: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\nif [ "$3" != "backup" ]; then exit 0; fi\n${backupBody}\n`);
  await chmod(path, 0o755);
  return path;
}

function cliWith(binary: string): RusticCli {
  // oxlint-disable-next-line node/no-process-env -- RusticCli reads its binary override at construction.
  process.env.RUSTIC_BIN = binary;
  return new RusticCli({
    repository: join(dir, "repo"),
    options: {},
    repoId: "otterdeploy-backups/res_test",
    passwordDomain: "otterdeploy-backups/res_test",
  });
}

/** A dump far larger than any pipe buffer, so an unread stdin EPIPEs. */
function bigDump(bytes: number): Readable {
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let left = bytes;
  return new Readable({
    read() {
      if (left <= 0) {
        this.push(null);
        return;
      }
      const next = chunk.subarray(0, Math.min(chunk.length, left));
      left -= next.length;
      this.push(next);
    },
  });
}

const TAGS = { stdinFilename: "dump", tags: ["otterdeploy", "backup:bak_1"] };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rustic-stdin-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  // oxlint-disable-next-line node/no-process-env -- undo the per-test binary override.
  delete process.env.RUSTIC_BIN;
});

describe("buildBackupStdinArgs", () => {
  it("always reads stdin into a fresh tree (--force: no parent reuse)", () => {
    expect(buildBackupStdinArgs(TAGS)).toEqual([
      "backup",
      "-",
      "--stdin-filename",
      "dump",
      "--tag",
      "otterdeploy,backup:bak_1",
      "--force",
      "--json",
    ]);
  });
});

describe("RusticCli.backupStdin", () => {
  it("records a snapshot when rustic stored every piped byte", async () => {
    const bin = await fakeRustic(
      "reads-all",
      `n=$(wc -c | tr -d ' ')\nprintf '{"id":"snap1","summary":{"total_bytes_processed":%s,"data_added":7}}' "$n"`,
    );
    const result = await cliWith(bin).backupStdin({ stdin: bigDump(3_000_000), ...TAGS });
    expect(result).toMatchObject({
      snapshotId: "snap1",
      sourceSizeBytes: 3_000_000,
      addedBytes: 7,
    });
  });

  it("fails, and does not crash the process, when rustic never reads a large dump", async () => {
    // What rustic did with a parent: exit 0 straight away, stdin untouched.
    const bin = await fakeRustic(
      "ignores-stdin",
      `printf '{"id":"stale","summary":{"total_bytes_processed":0}}'`,
    );
    const outcome = cliWith(bin).backupStdin({ stdin: bigDump(32 * 1024 * 1024), ...TAGS });
    await expect(outcome).rejects.toThrow(/did not reach rustic intact|stored 0 of/);
  });

  it("fails a small dump that rustic answered with a parent's content", async () => {
    // A dump that fits the pipe buffer never EPIPEs: only the byte count
    // shows the snapshot is not this dump.
    const bin = await fakeRustic(
      "stale-parent",
      `sleep 0.2\nprintf '{"id":"stale","summary":{"total_bytes_processed":0}}'`,
    );
    const outcome = cliWith(bin).backupStdin({
      stdin: Readable.from([Buffer.from("x".repeat(512))]),
      ...TAGS,
    });
    await expect(outcome).rejects.toBeInstanceOf(RusticDumpNotStoredError);
  });

  it("fails when the dump stream breaks part-way, even though rustic exits 0", async () => {
    const bin = await fakeRustic(
      "reads-what-arrives",
      `n=$(wc -c | tr -d ' ')\nprintf '{"id":"snap2","summary":{"total_bytes_processed":%s}}' "$n"`,
    );
    let sent = false;
    const broken = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(Buffer.alloc(1024, 0x62));
          return;
        }
        this.destroy(new Error("exec stream reset"));
      },
    });
    await expect(cliWith(bin).backupStdin({ stdin: broken, ...TAGS })).rejects.toThrow(
      /did not reach rustic intact: exec stream reset/,
    );
  });

  it("a rustic failure names rustic's own error, not the broken pipe it left", async () => {
    const bin = await fakeRustic("fails", `echo "Fatal: wrong password" >&2\nexit 3`);
    await expect(
      cliWith(bin).backupStdin({ stdin: bigDump(4 * 1024 * 1024), ...TAGS }),
    ).rejects.toThrow(/exited 3: Fatal: wrong password/);
  });

  it("a summary rustic did not print readably fails the backup", async () => {
    const bin = await fakeRustic("garbled", `cat >/dev/null\nprintf 'not json'`);
    await expect(
      cliWith(bin).backupStdin({ stdin: Readable.from([Buffer.from("x")]), ...TAGS }),
    ).rejects.toThrow(/printed no readable summary/);
  });

  it("a missing binary fails with the spawn error", async () => {
    const outcome = cliWith(join(dir, "no-such-rustic")).backupStdin({
      stdin: Readable.from([Buffer.from("x")]),
      ...TAGS,
    });
    await expect(outcome).rejects.toThrow(/ENOENT/);
  });
});

describe("RusticCli.ensureInit", () => {
  async function initBinary(name: string, body: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\nif [ "$3" = "init" ]; then\n${body}\nfi\nexit 0\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("tolerates an already-initialized repository", async () => {
    const bin = await initBinary("init-exists", `echo "Config file already exists" >&2\nexit 1`);
    await expect(cliWith(bin).ensureInit()).resolves.toBeUndefined();
  });

  it("surfaces any other init failure", async () => {
    const bin = await initBinary("init-denied", `echo "Access denied" >&2\nexit 1`);
    await expect(cliWith(bin).ensureInit()).rejects.toThrow(/Access denied/);
  });
});
