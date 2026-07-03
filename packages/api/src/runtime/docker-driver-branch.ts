/**
 * COW database-branching path for the plain-Docker runtime driver (see
 * `./docker-driver.ts`). P2 ships the `copy` strategy only: provision a fresh
 * branch DB, then copy the source's data in via the existing backups exec
 * transport (dump → restore). The `zfs` volume-clone path lands in P3.
 *
 * Split out of `docker-driver.ts` so that file stays focused on the
 * `RuntimeDriver` surface, mirroring the `./docker-driver-db.ts` split.
 * See docs/designs/pr-previews.md §4.4/§4.5.
 */

import { Docker } from "@otterdeploy/docker";
import { type ProjectId, type ResourceId } from "@otterdeploy/shared/id";
import { createError, log, type RequestLogger } from "evlog";

import type { BranchDatabaseSpec, DatabaseStatus } from "./types";

import { pgDumpToBuffer, pgRestoreFromBuffer } from "../backups/copy";
import { asStepLogger } from "../lib/logger";
import { runDatabase } from "./docker-driver-db";
import { findContainer, removeContainerByName } from "./docker-driver-helpers";
import { resolveSnapshotDriver } from "./snapshot";

/** Provision a branch of a running source database on the plain-Docker runtime. */
export async function branchDatabaseOnDocker(
  input: BranchDatabaseSpec,
  rlog?: RequestLogger,
): Promise<DatabaseStatus> {
  const step = asStepLogger(rlog);

  if (input.strategy !== "copy") {
    // P3 wires the zfs volume-clone path; until then only `copy` is real.
    throw createError({
      message: `branch strategy "${input.strategy}" is not implemented on the docker runtime yet`,
      status: 501,
      why: "only the copy strategy ships in P2; zfs volume-clone branching lands in P3",
    });
  }
  if (input.engine !== "postgres") {
    throw createError({
      message: `copy branching for ${input.engine} is not implemented`,
      status: 501,
      why: "v1 branches Postgres only (logical pg_dump/pg_restore)",
    });
  }
  const source = input.sourceCredentials;
  if (!source) {
    throw createError({
      message: "copy branching requires the source database credentials",
      status: 400,
      why: "pg_dump runs against the source DB; the caller must supply sourceCredentials",
    });
  }

  // Snapshot driver: for `copy` this is a documented no-op (returns null ref) —
  // the data movement happens below at the DB layer, not via a volume clone.
  const driver = await resolveSnapshotDriver();
  await driver.branch(
    { sourceVolume: input.sourceServiceName, targetVolume: input.volumeName, engine: input.engine },
    rlog,
  );

  // `copy` doubles disk — be loud about it (§4.2).
  log.warn({
    runtime: {
      step: "branch-db",
      strategy: "copy",
      service: input.serviceName,
      source: input.sourceServiceName,
      note: "copy strategy duplicates the source data (doubles disk); zfs (P3) is thin",
    },
  });

  // 1. Provision the fresh branch DB — its own name / volume / hostname / creds.
  step.info({ runtime: { step: "branch-db-provision", service: input.serviceName } });
  const status = await runDatabase(input);

  // 2. Copy data source→branch over the backups exec transport.
  const docker = Docker.fromEnv();
  try {
    const sourceContainer = await findContainer(docker, input.sourceServiceName);
    if (!sourceContainer) {
      throw createError({
        message: `source database ${input.sourceServiceName} is not running`,
        status: 409,
        why: "cannot pg_dump a source container that isn't up",
      });
    }
    const branchContainer = await findContainer(docker, input.serviceName);
    if (!branchContainer) {
      throw createError({
        message: `branch database ${input.serviceName} did not come up`,
        status: 500,
        why: "runDatabase returned but the branch container is not findable",
      });
    }

    step.info({ runtime: { step: "branch-db-dump", source: input.sourceServiceName } });
    const archive = await pgDumpToBuffer(docker, sourceContainer.Id, source);

    step.info({
      runtime: { step: "branch-db-restore", service: input.serviceName, bytes: archive.length },
    });
    await pgRestoreFromBuffer(
      docker,
      branchContainer.Id,
      { databaseName: input.databaseName, username: input.username, password: input.password },
      archive,
      input.resourceId,
    );
  } finally {
    docker.destroy();
  }

  return status;
}

/**
 * Tear down a branch DB — container AND its Docker volume(s). Unlike the normal
 * DB teardown (which orphans the volume), a branch's data is disposable, so we
 * discover the named volume(s) the branch mounts (via inspect) and remove them.
 * The COW-volume path (bind mounts under volumeDir + zfs snapshot destroy) is P3.
 */
export async function destroyDatabaseBranchOnDocker(
  input: {
    serviceName: string;
    projectId: ProjectId;
    resourceId: ResourceId;
    snapshotRef: string | null;
  },
  rlog?: RequestLogger,
): Promise<void> {
  const step = asStepLogger(rlog);
  const docker = Docker.fromEnv();
  try {
    // Discover the branch's named volumes BEFORE removing the container.
    const inspectResult = await docker.containers.inspect(input.serviceName);
    const volumeNames =
      inspectResult.isOk() && Array.isArray(inspectResult.value.Mounts)
        ? inspectResult.value.Mounts.filter((m) => m.Type === "volume" && m.Name).map(
            (m) => m.Name as string,
          )
        : [];

    step.info({ runtime: { step: "branch-db-remove-container", service: input.serviceName } });
    await removeContainerByName(docker, input.serviceName);

    for (const name of volumeNames) {
      step.info({ runtime: { step: "branch-db-remove-volume", volume: name } });
      const removed = await docker.volumes.getVolume(name).remove({ force: true });
      if (removed.isErr()) {
        // Non-fatal: log and continue so teardown of the rest still proceeds.
        log.warn({
          runtime: {
            step: "branch-db-remove-volume",
            volume: name,
            status: "error",
            message: removed.error.message,
          },
        });
      }
    }
    // snapshotRef is always null on the copy path — nothing snapshot-specific to
    // remove. zfs snapshot destroy is wired in P3.
  } finally {
    docker.destroy();
  }
}
