/**
 * Leaf helpers for the backup execution engine (engine.ts): secret resolution,
 * per-engine dump command construction, shell quoting, and the optional
 * pre-backup hook. Extracted so engine.ts stays focused on orchestration.
 */
import type { Docker } from "@otterdeploy/docker";
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import type { ExecutionContext } from "./db";

import { decryptSecret } from "../lib/crypto";
import { execCapture } from "./exec";

export async function resolveSecret(ctx: ExecutionContext): Promise<Record<string, string>> {
  if (!ctx.destination.encryptedSecret) return {};
  const json = await decryptSecret(ctx.destination.encryptedSecret);
  return JSON.parse(json) as Record<string, string>;
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
    case "mariadb": {
      // The MariaDB Docker Official Image dropped the `mysql*` symlinks at 11.0
      // (the dumper is `mariadb-dump` now) and we provision `mariadb:12` by
      // default, so `mysqldump` is absent from every MariaDB we ship. Genuine
      // `mysql:*` images map onto this same engine and have only `mysqldump`,
      // so pick whichever the container actually has rather than renaming.
      const args = `-u ${shellQuote(ctx.username)} ${shellQuote(ctx.databaseName)}`;
      return {
        cmd: [
          "sh",
          "-c",
          `if command -v mariadb-dump >/dev/null 2>&1; then exec mariadb-dump ${args}; fi; ` +
            `exec mysqldump ${args}`,
        ],
        env: [`MYSQL_PWD=${ctx.password}`],
        ext: "sql.gz",
        method: "mariadb-dump | gzip",
      };
    }
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
