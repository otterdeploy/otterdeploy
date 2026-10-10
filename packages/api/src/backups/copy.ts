/**
 * Logical DB copy over the existing docker-exec transport (exec.ts): the
 * primitive behind the `copy` DB-branching strategy (docs/designs/pr-previews.md
 * §4.2/§4.4). Dumps a source Postgres to an in-memory `pg_dump --format=custom`
 * archive and restores it into a fresh branch DB, both via exec inside the
 * engine's own container (no creds on the wire). Reuses `dumpCommand` (the same
 * command the backup engine builds) plus `execDump` / `execCapture`. This file
 * adds no new transport, only the branch-copy shaping.
 */
import type { Docker } from "@otterdeploy/docker";

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { dumpCommand, type DumpTarget } from "./engine-helpers";
import { execDump } from "./exec";
import { streamIntoExec } from "./restore-stream";

/** Postgres credentials for a dump/restore, engine implied (Postgres only for v1). */
export interface PgCopyCreds {
  databaseName: string;
  username: string;
  password: string;
}

/** Run `pg_dump --format=custom` in the source container and return the raw
 *  archive bytes. Throws on a non-zero exit (surfaces stderr). */
export async function pgDumpToBuffer(
  docker: Docker,
  containerId: string,
  creds: PgCopyCreds,
): Promise<Buffer> {
  const target: DumpTarget = { engine: "postgres", ...creds };
  const { cmd, env } = dumpCommand(target);
  const dump = await execDump(docker, containerId, cmd, env);
  // execDump now streams (backup pipes it into rustic); the copy/branch path
  // still wants the whole archive, so drain the stream into a buffer here.
  const chunks: Buffer[] = [];
  // The exec stream is binary (no encoding set), so chunks are Buffers at
  // runtime; `Buffer.from` covers the type-level string arm without a cast.
  for await (const chunk of dump.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const exitCode = await dump.exitCode;
  if (exitCode !== 0) {
    const stderr = await dump.stderr();
    throw new Error(`pg_dump exited ${exitCode}: ${stderr.slice(0, 1000)}`);
  }
  return Buffer.concat(chunks);
}

/** Restore a custom archive over exec stdin; archive size never enters argv. */
export async function pgRestoreFromBuffer(
  docker: Docker,
  containerId: string,
  creds: PgCopyCreds,
  archive: Buffer,
  _tag: string,
): Promise<void> {
  const restore = await streamIntoExec({
    docker,
    containerId,
    cmd: [
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "-U",
      creds.username,
      "-d",
      creds.databaseName,
    ],
    env: [`PGPASSWORD=${creds.password}`],
    write: async (stdin) => {
      await pipeline(Readable.from([archive]), stdin);
    },
  });
  if (restore.exitCode !== 0) {
    throw new Error(
      `pg_restore failed (exit ${restore.exitCode}): ${restore.stderr.slice(0, 2000)}`,
    );
  }
}
