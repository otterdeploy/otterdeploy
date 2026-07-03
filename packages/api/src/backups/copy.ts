/**
 * Logical DB copy over the existing docker-exec transport (exec.ts) — the
 * primitive behind the `copy` DB-branching strategy (docs/designs/pr-previews.md
 * §4.2/§4.4). Dumps a source Postgres to an in-memory `pg_dump --format=custom`
 * archive and restores it into a fresh branch DB, both via exec inside the
 * engine's own container (no creds on the wire). Reuses `dumpCommand` (the same
 * command the backup engine builds) plus `execDump` / `execCapture` — this file
 * adds no new transport, only the branch-copy shaping.
 */
import type { Docker } from "@otterdeploy/docker";

import { dumpCommand, type DumpTarget, shellQuote } from "./engine-helpers";
import { execCapture, execDump } from "./exec";

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
  if (dump.exitCode !== 0) {
    throw new Error(`pg_dump exited ${dump.exitCode}: ${dump.stderr.slice(0, 1000)}`);
  }
  return dump.archive;
}

/** Restore a `pg_dump --format=custom` archive into the branch container. Stages
 *  the archive to a temp file (base64 over exec) then `pg_restore`s it. Throws
 *  on a failed restore so a corrupt branch never reads as healthy. */
export async function pgRestoreFromBuffer(
  docker: Docker,
  containerId: string,
  creds: PgCopyCreds,
  archive: Buffer,
  tag: string,
): Promise<void> {
  const tmp = `/tmp/branch-restore-${tag}.dump`;
  const b64 = archive.toString("base64");
  await execCapture(docker, containerId, ["sh", "-c", `echo ${shellQuote(b64)} | base64 -d > ${tmp}`]);
  // Allow non-zero at the exec layer only so we can capture stderr and surface
  // it — a silent success on a failed restore would hide a broken branch.
  const restore = await execCapture(
    docker,
    containerId,
    [
      "sh",
      "-c",
      `pg_restore --clean --if-exists --no-owner -U ${shellQuote(creds.username)} -d ${shellQuote(
        creds.databaseName,
      )} ${tmp}`,
    ],
    { env: [`PGPASSWORD=${creds.password}`], allowNonZero: true },
  );
  // Separate exec so its exit can't mask pg_restore's.
  await execCapture(docker, containerId, ["rm", "-f", tmp], { allowNonZero: true });
  if (restore.exitCode !== 0) {
    throw new Error(`pg_restore failed (exit ${restore.exitCode}): ${restore.stderr.slice(0, 2000)}`);
  }
}
