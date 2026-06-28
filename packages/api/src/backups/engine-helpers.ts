/**
 * Leaf helpers for the backup execution engine (engine.ts): secret resolution,
 * per-engine dump command construction, shell quoting, and the optional
 * pre-backup hook. Extracted so engine.ts stays focused on orchestration.
 */
import type { Docker } from "@otterdeploy/docker";

import type { ExecutionContext } from "./db";

import { decryptSecret } from "../lib/crypto";
import { execCapture } from "./exec";

export async function resolveSecret(ctx: ExecutionContext): Promise<Record<string, string>> {
  if (!ctx.destination.encryptedSecret) return {};
  const json = await decryptSecret(ctx.destination.encryptedSecret);
  return JSON.parse(json) as Record<string, string>;
}

export function dumpCommand(ctx: ExecutionContext): {
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
