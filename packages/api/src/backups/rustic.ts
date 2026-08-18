import { env } from "@otterdeploy/env/server";
import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
/**
 * Thin wrapper around the `rustic` CLI (v0.11.3, GNU x86_64, vendored into the
 * server image, see apps/server/Dockerfile). rustic is the ONLY backup engine:
 * dedup + incremental + zstd + repo-key encryption, driven entirely by
 * shell-outs. No restic-Go, no napi, no fallback tool.
 *
 * Backend options and the repo password can't ride on argv (rustic has no `-o`
 * flag, and secrets must never appear in a process listing). So every call
 * writes a throwaway 0600 config-profile TOML into the host tmp dir carrying:
 *
 *     [repository]
 *     repository = "<url>"        # local path or opendal:<svc>
 *     password   = "<hkdf hex>"   # HKDF-SHA256(BETTER_AUTH_SECRET, info=passwordDomain)
 *     [repository.options]        # OpenDAL backend keys (bucket, root, …)
 *
 * and invokes `rustic -P <profilePathWithout.toml> <subcmd> …`. The profile is
 * unlinked after every invocation. stderr is streamed line-by-line to a log callback so
 * a run's progress/errors land in the backup log; a non-zero exit rejects.
 *
 * The verified rustic command surface lives in docs/rustic-backup-implementation-plan.md §0.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as z from "zod";

import type { RusticRepo } from "./backends";

import { masterSecretCandidates } from "../lib/crypto";
import {
  type ForgetSpec,
  buildRusticProfile,
  buildForgetArgs,
  deriveRepoPassword,
  isPasswordError,
} from "./rustic-args";

// Re-exported so existing importers (tests, retention-apply, scheduler) keep
// their `./rustic` entry point.
export {
  type ForgetSpec,
  buildForgetArgs,
  deriveRepoPassword,
  isPasswordError,
} from "./rustic-args";

/** Where run progress/errors are surfaced (matches the engine's log closure). */
type LogFn = (stream: "stdout" | "stderr" | "system", line: string) => void | Promise<void>;

/** Result of a stdin backup: the fields the engine writes onto the run row. */
export interface BackupStdinResult {
  /** 64-hex snapshot id (goes to `storagePath`). */
  snapshotId: string;
  /** Uncompressed source size (`summary.total_bytes_processed`). */
  sourceSizeBytes: number;
  /** New bytes this snapshot added to the repo (`summary.data_added`). */
  addedBytes: number;
  /** Wall-clock duration of the backup invocation. */
  durationMs: number;
}

/** `rustic backup --json` stdout: only the fields the engine reads. */
const rusticBackupOutput = z.object({
  id: z.string().optional(),
  summary: z
    .object({
      total_bytes_processed: z.number().optional(),
      data_added: z.number().optional(),
    })
    .optional(),
});

/** `rustic snapshots <id> --json` stdout: grouped snapshot lists. */
const rusticSnapshotGroups = z.array(z.object({ snapshots: z.array(z.unknown()).optional() }));

export class RusticCli {
  // oxlint-disable-next-line node/no-process-env -- binary path override; not part of the app env schema.
  private readonly binary = process.env.RUSTIC_BIN ?? "/usr/local/bin/rustic";

  /** Index into the keyring candidates that last opened this repo. Starts at
   *  the current key; bumped by the fallback when an older secret matches. */
  private candidateIndex = 0;

  constructor(
    private readonly repo: RusticRepo,
    private readonly log: LogFn = () => {},
  ) {}

  /** Candidate passwords, current keyring secret first (see
   *  masterSecretCandidates). Rotation = add a new keyring id + repoint
   *  DATA_ENCRYPTION_KEY_ID; repos re-key themselves on next touch. */
  private passwords(): string[] {
    const secrets = masterSecretCandidates();
    const base = secrets.length > 0 ? secrets : [env.BETTER_AUTH_SECRET];
    return [...new Set(base.map((s) => deriveRepoPassword(s, this.repo.passwordDomain)))];
  }

  /** Write the throwaway profile, run `rustic -P <base> <args>`, always unlink it. */
  private async runWithPassword(
    password: string,
    subArgs: string[],
    opts: { stdin?: Readable; stdout?: Writable } = {},
  ): Promise<string> {
    const base = join(tmpdir(), `rustic-${randomBytes(12).toString("hex")}`);
    // `-P <base>` reads `<base>.toml` (verified). Write with the extension,
    // pass the extensionless base.
    await writeFile(`${base}.toml`, buildRusticProfile(this.repo, password), { mode: 0o600 });
    const spawned = await Result.tryPromise({
      try: () => this.spawn(["-P", base, ...subArgs], opts),
      catch: errorFromUnknown,
    });
    const cleaned = await Result.tryPromise({
      try: () => unlink(`${base}.toml`),
      catch: errorFromUnknown,
    });
    if (cleaned.isErr()) throw cleaned.error;
    if (spawned.isErr()) throw spawned.error;
    return spawned.value;
  }

  /**
   * Run with the current candidate password; on a wrong-password failure, walk
   * the remaining keyring candidates. When an OLDER secret opens the repo,
   * best-effort `key add` the current-secret password so the repo re-keys to
   * the new keyring entry: the rotation path that makes rotating the root
   * secret survivable. A consumed stdin can't be replayed, so stdin calls
   * don't fall back (the engine opens the repo with `ensureInit` first, which
   * settles the candidate before any stdin is attached).
   */
  private async run(
    subArgs: string[],
    opts: { stdin?: Readable; stdout?: Writable } = {},
  ): Promise<string> {
    const candidates = this.passwords();
    let index = Math.min(this.candidateIndex, candidates.length - 1);
    for (;;) {
      const attempt = await Result.tryPromise({
        try: () => this.runWithPassword(candidates[index] ?? "", subArgs, opts),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      if (attempt.isOk()) {
        if (index !== 0) await this.rekeyToCurrent(candidates[index] ?? "", candidates[0] ?? "");
        this.candidateIndex = index;
        return attempt.value;
      }
      const canFallBack =
        isPasswordError(attempt.error.message) && index < candidates.length - 1 && !opts.stdin;
      if (!canFallBack) throw attempt.error;
      index += 1;
      void this.log("system", "repo password from a previous keyring entry; trying older secrets");
    }
  }

  /** Best-effort `key add` of the current-secret password using a working old
   *  one. Failure only means the repo stays keyed to the old entry (still
   *  readable via fallback); never fails the caller's operation. */
  private async rekeyToCurrent(workingPassword: string, currentPassword: string): Promise<void> {
    const file = join(tmpdir(), `rustic-key-${randomBytes(12).toString("hex")}`);
    const outcome = await Result.tryPromise({
      try: async () => {
        await writeFile(file, `${currentPassword}\n`, { mode: 0o600 });
        await this.runWithPassword(workingPassword, ["key", "add", "--new-password-file", file]);
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    await Result.tryPromise({
      try: () => unlink(file),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (outcome.isOk()) {
      this.candidateIndex = 0;
      void this.log("system", "repo re-keyed to the current keyring entry");
    } else {
      void this.log("system", `repo re-key skipped: ${outcome.error.message.slice(0, 300)}`);
    }
  }

  /** Spawn rustic; stream stderr to the log, collect (or pipe) stdout, reject non-zero. */
  private spawn(args: string[], opts: { stdin?: Readable; stdout?: Writable }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, {
        stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
        // Inherit PATH etc.; NO_COLOR strips ANSI so logs + error text stay clean.
        // No secrets ride on env or argv: the password lives in the profile.
        // oxlint-disable-next-line node/no-process-env -- inherit host env for the child; per-call additions only.
        env: { ...process.env, NO_COLOR: "1" },
      });

      const { stdout, stderr } = child;
      if (!stdout || !stderr) {
        reject(new Error("rustic: child process is missing stdout/stderr"));
        return;
      }

      const outChunks: Buffer[] = [];
      if (opts.stdout) stdout.pipe(opts.stdout);
      else stdout.on("data", (c: Buffer) => outChunks.push(c));

      const errTail: string[] = [];
      let carry = "";
      stderr.setEncoding("utf8");
      stderr.on("data", (chunk: string) => {
        carry += chunk;
        let idx: number;
        while ((idx = carry.indexOf("\n")) !== -1) {
          const line = carry.slice(0, idx);
          carry = carry.slice(idx + 1);
          if (line.length > 0) this.emitStderr(line, errTail);
        }
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (carry.length > 0) this.emitStderr(carry, errTail);
        if (code === 0) {
          resolve(Buffer.concat(outChunks).toString("utf8"));
        } else {
          const detail = errTail.slice(-3).join("; ");
          reject(
            new Error(`rustic ${args.join(" ")} exited ${code}${detail ? `: ${detail}` : ""}`),
          );
        }
      });

      if (opts.stdin) {
        const childStdin = child.stdin;
        if (!childStdin) {
          reject(new Error("rustic: child process is missing stdin"));
          return;
        }
        opts.stdin.on("error", reject);
        opts.stdin.pipe(childStdin);
      }
    });
  }

  private emitStderr(line: string, tail: string[]): void {
    tail.push(line);
    if (tail.length > 16) tail.shift();
    void this.log("stderr", line);
  }

  /** Initialize the repo, tolerating an already-initialized one (idempotent). */
  async ensureInit(): Promise<void> {
    try {
      await this.run(["init"]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // rustic aborts a re-init with "Config file already exists". Treat as OK.
      if (/already (exists|initialized)/i.test(message)) return;
      throw cause;
    }
  }

  /** Back up a piped stream as a single-file snapshot; returns the run metrics. */
  async backupStdin(input: {
    stdin: Readable;
    stdinFilename: string;
    tags: string[];
  }): Promise<BackupStdinResult> {
    const started = Date.now();
    const stdout = await this.run(
      [
        "backup",
        "-",
        "--stdin-filename",
        input.stdinFilename,
        "--tag",
        input.tags.join(","),
        "--json",
      ],
      { stdin: input.stdin },
    );
    const durationMs = Date.now() - started;
    const parsed = rusticBackupOutput.parse(JSON.parse(stdout));
    if (!parsed.id) throw new Error("rustic backup returned no snapshot id");
    return {
      snapshotId: parsed.id,
      sourceSizeBytes: parsed.summary?.total_bytes_processed ?? 0,
      addedBytes: parsed.summary?.data_added ?? 0,
      durationMs,
    };
  }

  /** Stream one file out of a snapshot to a Writable (`dump <id>:<name>`). */
  async dumpToStream(input: {
    snapshotId: string;
    filenameInSnapshot: string;
    out: Writable;
  }): Promise<void> {
    await this.run(["dump", `${input.snapshotId}:${input.filenameInSnapshot}`], {
      stdout: input.out,
    });
  }

  /** Restore a snapshot's tree into a directory on disk (`restore <id> <dir>`). */
  async restoreToPath(input: { snapshotId: string; targetDir: string }): Promise<void> {
    await this.run(["restore", input.snapshotId, input.targetDir]);
  }

  /** Apply a keep policy scoped to the given tags, then prune (`forget … --prune`). */
  async forget(spec: ForgetSpec, filterTags: string[]): Promise<void> {
    await this.run(buildForgetArgs(spec, filterTags));
  }

  /** Remove SPECIFIC snapshots by id, then prune (`forget <id>… --prune`).
   *  This is what enforces the byte-ceiling retention: the selection is
   *  computed in retention.ts and executed here at the snapshot level. */
  async forgetSnapshots(snapshotIds: string[]): Promise<void> {
    if (snapshotIds.length === 0) return;
    await this.run(["forget", ...snapshotIds, "--prune", "--json"]);
  }

  /** Structural integrity check of the whole repo (`check`). */
  async check(): Promise<void> {
    await this.run(["check"]);
  }

  /** Whether a snapshot id resolves in the repo (`snapshots <id> --json`). */
  async snapshotExists(snapshotId: string): Promise<boolean> {
    let stdout: string;
    try {
      stdout = await this.run(["snapshots", snapshotId, "--json"]);
    } catch {
      // rustic exits non-zero when the id matches nothing: treat as absent.
      return false;
    }
    try {
      const groups = rusticSnapshotGroups.parse(JSON.parse(stdout));
      return groups.some((g) => (g.snapshots?.length ?? 0) > 0);
    } catch {
      return false;
    }
  }
}
