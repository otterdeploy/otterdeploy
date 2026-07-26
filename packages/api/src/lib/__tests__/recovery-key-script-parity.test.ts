/**
 * Cross-implementation parity between `recovery-key.ts` (used by the API +
 * web UI to generate keys and store fingerprints) and
 * `scripts/lib/recovery-key.mjs` (the zero-dependency script
 * `scripts/control-plane-backup.sh` / `control-plane-restore.sh` actually
 * shell out to for archive encrypt/decrypt on a fresh VPS — see that file's
 * header comment for why it can't just import this module).
 *
 * The two are hand-kept in sync rather than sharing code (the script must
 * work with nothing but a bare `bun` runtime, no workspace resolution). This
 * test is the thing that makes "hand-kept in sync" a checked claim instead of
 * an assertion in a comment: it shells out to the REAL script as a
 * subprocess and proves archives produced by one side decrypt cleanly on the
 * other, in both directions, including the failure paths (wrong key,
 * tampered ciphertext).
 *
 * Requires `bun` on PATH (true in this repo's dev/CI environment — same
 * requirement every other test here already has).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  generateRecoveryKey,
  unwrapControlPlaneArchive,
  wrapControlPlaneArchive,
} from "../recovery-key";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../../../../scripts/lib/recovery-key.mjs", import.meta.url),
);

function runScript(args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync("bun", [SCRIPT_PATH, ...args], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "otterdeploy-recovery-key-parity-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("recovery-key.ts <-> scripts/lib/recovery-key.mjs parity", () => {
  it("script-generated key + fingerprint match the TS module's own format", () => {
    const gen = spawnSync("bun", [SCRIPT_PATH, "generate"], { encoding: "utf8" });
    expect(gen.status).toBe(0);
    const key = gen.stdout.trim();
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    const fp = spawnSync("bun", [SCRIPT_PATH, "fingerprint", "--key", key], { encoding: "utf8" });
    expect(fp.status).toBe(0);
    expect(fp.stdout.trim()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("TS wraps, script unwraps — same plaintext out", async () => {
    const key = generateRecoveryKey();
    const plaintext = Buffer.from("control-plane archive: pg_dump + data dir + caddy state");
    const wrapped = await wrapControlPlaneArchive(plaintext, key);

    const inPath = join(dir, "archive.enc");
    const outPath = join(dir, "archive.dec");
    writeFileSync(inPath, wrapped);

    const result = runScript(["decrypt", "--in", inPath, "--out", outPath, "--key", key]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outPath)).toEqual(plaintext);
  });

  it("script wraps, TS unwraps — same plaintext out", async () => {
    const gen = spawnSync("bun", [SCRIPT_PATH, "generate"], { encoding: "utf8" });
    const key = gen.stdout.trim();

    const inPath = join(dir, "plain.bin");
    const outPath = join(dir, "plain.enc");
    const plaintext = Buffer.from("round trip the other direction too");
    writeFileSync(inPath, plaintext);

    const result = runScript(["encrypt", "--in", inPath, "--out", outPath, "--key", key]);
    expect(result.status, result.stderr).toBe(0);

    const wrapped = readFileSync(outPath);
    const unwrapped = await unwrapControlPlaneArchive(wrapped, key);
    expect(Buffer.compare(unwrapped, plaintext)).toBe(0);
  });

  it("the script rejects a wrong key with a mismatch error, matching the TS module's behavior", async () => {
    const key = generateRecoveryKey();
    const wrongKey = generateRecoveryKey();
    const plaintext = Buffer.from("secret");
    const wrapped = await wrapControlPlaneArchive(plaintext, key);

    const inPath = join(dir, "archive.enc");
    const outPath = join(dir, "archive.dec");
    writeFileSync(inPath, wrapped);

    const result = runScript(["decrypt", "--in", inPath, "--out", outPath, "--key", wrongKey]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not match this archive/);
  });

  it("the script detects tampering the same way the TS module does", async () => {
    const key = generateRecoveryKey();
    const plaintext = Buffer.from("data that must not be silently corrupted");
    const wrapped = await wrapControlPlaneArchive(plaintext, key);
    const tampered = Buffer.from(wrapped);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;

    const inPath = join(dir, "archive.enc");
    const outPath = join(dir, "archive.dec");
    writeFileSync(inPath, tampered);

    const result = runScript(["decrypt", "--in", inPath, "--out", outPath, "--key", key]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/corrupt or was tampered/);
  });
});
