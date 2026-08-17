/**
 * Leaf helpers for the backup execution engine (engine.ts): secret resolution,
 * per-engine dump command construction, shell quoting, and the optional
 * pre-backup hook. Extracted so engine.ts stays focused on orchestration.
 */
import type { Docker } from "@otterdeploy/docker";
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import * as z from "zod";

import type { ExecutionContext } from "./db";

import { decryptSecret } from "../lib/crypto";
import { execCapture } from "./exec";

const secretSchema = z.record(z.string(), z.string());

export async function resolveSecret(ctx: ExecutionContext): Promise<Record<string, string>> {
  if (!ctx.destination.encryptedSecret) return {};
  const json = await decryptSecret(ctx.destination.encryptedSecret);
  return secretSchema.parse(JSON.parse(json));
}

/** The minimal engine + credential surface `dumpCommand` needs. `ExecutionContext`
 *  is a structural superset, so existing callers pass it unchanged; the COW
 *  branch copy path (runtime/snapshot) builds this narrow shape directly. */
export interface DumpTarget {
  engine: DatabaseEngine;
  databaseName: string;
  username: string;
  password: string;
}

export function dumpCommand(ctx: DumpTarget): {
  cmd: string[];
  env: string[];
  ext: string;
  method: string;
} {
  switch (ctx.engine) {
    case "postgres":
      return {
        cmd: [
          "pg_dump",
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "-U",
          ctx.username,
          "-d",
          ctx.databaseName,
        ],
        env: [`PGPASSWORD=${ctx.password}`],
        ext: "dump.gz",
        method: "pg_dump --format=custom | gzip",
      };
    case "mariadb":
      return {
        cmd: [
          "sh",
          "-c",
          `exec mysqldump -u ${shellQuote(ctx.username)} ${shellQuote(ctx.databaseName)}`,
        ],
        env: [`MYSQL_PWD=${ctx.password}`],
        ext: "sql.gz",
        method: "mysqldump | gzip",
      };
    case "mongodb":
      return {
        cmd: [
          "mongodump",
          "--archive",
          `--db=${ctx.databaseName}`,
          `--username=${ctx.username}`,
          `--password=${ctx.password}`,
          "--authenticationDatabase=admin",
        ],
        env: [],
        ext: "archive.gz",
        method: "mongodump --archive | gzip",
      };
    case "redis":
      throw new Error("redis backups are not supported (no logical dump); use a volume backup");
    default:
      // clickhouse / rabbitmq / minio / meilisearch have no logical-dump path
      // here. Throw (rather than fall through to an undefined return) so the
      // caller fails loudly instead of building an empty command.
      throw new Error(`logical dump is not supported for engine "${ctx.engine}"`);
  }
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Physical backup command: a pg_basebackup tar of the WHOLE cluster streamed
 * to stdout (postgres only). `--wal-method=fetch` bundles the WAL needed for
 * a consistent restore into the tar, so the archive is self-contained.
 * Restores by extracting into a fresh data directory (download, not
 * in-place); continuous WAL archiving + PITR build on this later.
 */
export function physicalDumpCommand(ctx: DumpTarget): {
  cmd: string[];
  env: string[];
  method: string;
} {
  if (ctx.engine !== "postgres") {
    throw new Error(`physical backups are postgres-only (engine "${ctx.engine}")`);
  }
  return {
    cmd: ["pg_basebackup", "--pgdata=-", "--format=tar", "--wal-method=fetch", "-U", ctx.username],
    env: [`PGPASSWORD=${ctx.password}`],
    method: "pg_basebackup --format=tar --wal-method=fetch",
  };
}

/**
 * Per-engine in-place restore command, the mirror of `dumpCommand`: reads the
 * dump format that engine's dump produces from stdin and loads it into the
 * live database. Same in-container exec model, so credentials stay off the
 * wire and the restore client matches the server version by construction.
 */
export function restoreCommand(ctx: DumpTarget): { cmd: string[]; env: string[]; method: string } {
  switch (ctx.engine) {
    case "postgres":
      return {
        cmd: [
          "pg_restore",
          "--clean",
          "--if-exists",
          "--no-owner",
          "-U",
          ctx.username,
          "-d",
          ctx.databaseName,
        ],
        env: [`PGPASSWORD=${ctx.password}`],
        method: "pg_restore --clean --if-exists",
      };
    case "mariadb":
      // mysqldump emits plain SQL; the mysql client replays it. mariadb images
      // ship both `mysql` and `mariadb` client names; `mysql` exists on both.
      return {
        cmd: ["sh", "-c", `exec mysql -u ${shellQuote(ctx.username)} ${shellQuote(ctx.databaseName)}`],
        env: [`MYSQL_PWD=${ctx.password}`],
        method: "mysql < dump.sql",
      };
    case "mongodb":
      return {
        cmd: [
          "mongorestore",
          "--archive",
          "--drop",
          `--nsInclude=${ctx.databaseName}.*`,
          `--username=${ctx.username}`,
          `--password=${ctx.password}`,
          "--authenticationDatabase=admin",
        ],
        env: [],
        method: "mongorestore --archive --drop",
      };
    case "redis":
      throw new Error("redis has no dump restore; restore the volume backup instead");
    default:
      throw new Error(`in-place restore is not supported for engine "${ctx.engine}"`);
  }
}

/** Filesystem the engine's data lives on inside its container, for the
 *  disk-space preflight before an in-place restore. */
export function engineDataDir(engine: DatabaseEngine): string {
  switch (engine) {
    case "postgres":
      return "/var/lib/postgresql/data";
    case "mariadb":
      return "/var/lib/mysql";
    case "mongodb":
      return "/data/db";
    default:
      return "/";
  }
}

type LogFn = (stream: "stdout" | "stderr" | "system", line: string) => Promise<void>;

/**
 * Run a schedule's pre-backup hook inside the DB container before dumping. No-op
 * when unset; a non-zero exit aborts the backup (the caller catches + fails it).
 */
export async function runPreHook(
  docker: Docker,
  containerId: string,
  preHook: string | null,
  log: LogFn,
): Promise<void> {
  if (!preHook || !preHook.trim()) return;
  await log("system", `Running pre-hook: ${preHook}`);
  const hook = await execCapture(docker, containerId, ["sh", "-c", preHook], {
    allowNonZero: true,
  });
  if (hook.stdout.trim()) await log("stdout", hook.stdout.trim().slice(0, 4000));
  if (hook.stderr.trim()) await log("stderr", hook.stderr.trim().slice(0, 4000));
  if (hook.exitCode !== 0) throw new Error(`pre-hook exited ${hook.exitCode}`);
}
