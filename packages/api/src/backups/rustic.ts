/**
 * Thin wrapper around the `rustic` CLI (v0.11.3, GNU x86_64 — vendored into the
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
 *     password   = "<hkdf hex>"   # HKDF-SHA256(BETTER_AUTH_SECRET, info=repoId)
 *     [repository.options]        # OpenDAL backend keys (bucket, root, …)
 *
 * and invokes `rustic -P <profilePathWithout.toml> <subcmd> …`. The profile is
 * unlinked in a `finally`. stderr is streamed line-by-line to a log callback so
 * a run's progress/errors land in the backup log; a non-zero exit rejects.
 *
 * The verified rustic command surface lives in docs/rustic-backup-implementation-plan.md §0.
 */
import { spawn } from "node:child_process";
import { hkdfSync, randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { env } from "@otterdeploy/env/server";

import type { RusticRepo } from "./backends";

/** Where run progress/errors are surfaced (matches the engine's log closure). */
type LogFn = (
  stream: "stdout" | "stderr" | "system",
  line: string,
) => void | Promise<void>;

/** Result of a stdin backup — the fields the engine writes onto the run row. */
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

/** GFS keep policy for `forget` — maps 1:1 onto rustic's `--keep-*` flags. */
export interface ForgetSpec {
  keepLast?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  /** Hard max age in days → `--keep-within <N>d`. */
  keepWithinDays?: number | null;
}

/**
 * Derive a repo's encryption password: HKDF-SHA256 over `BETTER_AUTH_SECRET`
 * with `info = repoId`, hex-encoded. Deterministic (re-derivable, no secret
 * store) and domain-separated per repo. Pure so it's unit-testable without env.
 *
 * ⚠️ Rotating `BETTER_AUTH_SECRET` re-derives every password → existing repos
 * become unreadable. Operational constraint; there's no rotation path in v1.
 */
export function deriveRepoPassword(secret: string, repoId: string): string {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.alloc(0),
    Buffer.from(repoId, "utf8"),
    32,
  );
  return Buffer.from(derived).toString("hex");
}

/** Build the `forget` argv (pure, so the flag mapping is unit-testable). Only
 *  set tiers emit a flag; always scoped by `--filter-tags` and always `--prune`
 *  + `--json`. */
export function buildForgetArgs(spec: ForgetSpec, filterTags: string[]): string[] {
  const args = ["forget", "--filter-tags", filterTags.join(",")];
  const tier = (flag: string, n: number | undefined) => {
    if (n != null && n > 0) args.push(flag, String(n));
  };
  tier("--keep-last", spec.keepLast);
  tier("--keep-daily", spec.keepDaily);
  tier("--keep-weekly", spec.keepWeekly);
  tier("--keep-monthly", spec.keepMonthly);
  tier("--keep-yearly", spec.keepYearly);
  if (spec.keepWithinDays != null && spec.keepWithinDays > 0) {
    args.push("--keep-within", `${spec.keepWithinDays}d`);
  }
  args.push("--prune", "--json");
  return args;
}

/** Quote a value as a TOML basic string (escapes `\`, `"`, and controls). */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export class RusticCli {
  private readonly binary = process.env.RUSTIC_BIN ?? "/usr/local/bin/rustic";

  constructor(
    private readonly repo: RusticRepo,
    private readonly log: LogFn = () => {},
  ) {}

  /** This repo's HKDF-derived password (never placed on argv). */
  private password(): string {
    return deriveRepoPassword(env.BETTER_AUTH_SECRET, this.repo.repoId);
  }

  /** The config-profile TOML delivering repository URL, password, and backend options. */
  private profileToml(): string {
    const lines = [
      "[repository]",
      `repository = ${tomlString(this.repo.repository)}`,
      `password = ${tomlString(this.password())}`,
    ];
    const keys = Object.keys(this.repo.options);
    if (keys.length > 0) {
      lines.push("", "[repository.options]");
      for (const key of keys) {
        lines.push(`${key} = ${tomlString(this.repo.options[key] ?? "")}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  /** Write the throwaway profile, run `rustic -P <base> <args>`, always unlink it. */
  private async run(
    subArgs: string[],
    opts: { stdin?: Readable; stdout?: Writable } = {},
  ): Promise<string> {
    const base = join(tmpdir(), `rustic-${randomBytes(12).toString("hex")}`);
    // `-P <base>` reads `<base>.toml` (verified) — write with the extension,
    // pass the extensionless base.
    await writeFile(`${base}.toml`, this.profileToml(), { mode: 0o600 });
    try {
      return await this.spawn(["-P", base, ...subArgs], opts);
    } finally {
      await unlink(`${base}.toml`).catch(() => undefined);
    }
  }

  /** Spawn rustic; stream stderr to the log, collect (or pipe) stdout, reject non-zero. */
  private spawn(
    args: string[],
    opts: { stdin?: Readable; stdout?: Writable },
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, {
        stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
        // Inherit PATH etc.; NO_COLOR strips ANSI so logs + error text stay clean.
        // No secrets ride on env or argv — the password lives in the profile.
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
          reject(new Error(`rustic ${args.join(" ")} exited ${code}${detail ? `: ${detail}` : ""}`));
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
      // rustic aborts a re-init with "Config file already exists" — treat as OK.
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
    const parsed = JSON.parse(stdout) as {
      id?: string;
      summary?: { total_bytes_processed?: number; data_added?: number };
    };
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
      // rustic exits non-zero when the id matches nothing — treat as absent.
      return false;
    }
    try {
      const groups = JSON.parse(stdout) as Array<{ snapshots?: unknown[] }>;
      return groups.some((g) => (g.snapshots?.length ?? 0) > 0);
    } catch {
      return false;
    }
  }
}
