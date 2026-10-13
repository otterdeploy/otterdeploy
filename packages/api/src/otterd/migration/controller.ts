import type { BeforeImage } from "@otterdeploy/db/schema/otterd-migration";
/**
 * The host side of moving a plain-Docker resource onto otterd, run where the
 * Docker daemon is. Every step is journalled before the next one acts, and a
 * failure before the node adopted the container is compensated in place:
 *
 *   migrate:  before-image → hold (owner `migrating`) → otterd service
 *             written → restart policy `no`, verified with the same process
 *             (pid and start time unchanged) → adoption requested → wait for
 *             the control plane's adoption → owner `otterd`.
 *   rollback: hold again → give the container back (`release-adoption`,
 *             which restores the before-image restart policy) → the otterd
 *             service is forgotten → owner `legacy`.
 *   finalize: once nothing is left on the legacy runtime, the session is
 *             finalized: the control plane deletes adopted containers a stop
 *             left behind, and the server stops initializing Swarm.
 */
import type { Docker } from "@otterdeploy/docker";

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { setTimeout as sleep } from "node:timers/promises";

import { grantRow } from "../store/adopt";
import { putService } from "../store/services";
import { buildHostNode } from "../store/status";
import { forgetService } from "./cp-store";
import { preflight } from "./inventory";
import { migrationSpecFor } from "./specs";
import {
  type MigrationRow,
  allRows,
  currentSession,
  holdResource,
  migrationRow,
  setSessionState,
  stepResource,
} from "./store";

const now = (): number => Temporal.Now.instant().epochMilliseconds;
const WAIT_MS = 60_000;

async function inspect(docker: Docker, id: string) {
  const r = await docker.containers.inspect(id);
  if (r.isErr()) throw new Error(`docker inspect ${id}: ${r.error.message}`);
  return r.value;
}

type Inspected = Awaited<ReturnType<typeof inspect>>;

function restartPolicyOf(c: Inspected): BeforeImage["restartPolicy"] {
  const p = c.HostConfig?.RestartPolicy;
  const retries = p?.MaximumRetryCount ?? 0;
  return { name: p?.Name || "no", ...(retries > 0 ? { maximumRetryCount: retries } : {}) };
}

const mountsOf = (c: Inspected): BeforeImage["mounts"] =>
  (c.Mounts ?? []).map((m) => ({
    type: m.Type ?? "",
    source: m.Name ?? m.Source ?? "",
    target: m.Destination ?? "",
  }));

async function beforeImage(docker: Docker, id: string): Promise<BeforeImage> {
  const c = await inspect(docker, id);
  return {
    containerId: c.Id ?? id,
    name: (c.Name ?? "").replace(/^\//, ""),
    image: c.Config?.Image ?? "",
    restartPolicy: restartPolicyOf(c),
    pid: c.State?.Pid ?? 0,
    startedAt: c.State?.StartedAt ?? "",
    networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
    ports: Object.keys(c.NetworkSettings?.Ports ?? {}),
    mounts: mountsOf(c),
  };
}

/** Restart policy `no`, then prove the same process still runs. */
async function disableRestart(docker: Docker, before: BeforeImage): Promise<void> {
  const r = await docker.containers
    .getContainer(before.containerId)
    .update({ RestartPolicy: { Name: "no" } });
  if (r.isErr()) throw new Error(`docker update: ${r.error.message}`);
  const after = await inspect(docker, before.containerId);
  if (after.HostConfig?.RestartPolicy?.Name !== "no")
    throw new Error("restart policy did not change");
  if (after.State?.Pid !== before.pid || after.State?.StartedAt !== before.startedAt) {
    throw new Error("the container restarted while its restart policy changed");
  }
}

async function restoreRestart(docker: Docker, before: BeforeImage): Promise<void> {
  await docker.containers.getContainer(before.containerId).update({
    RestartPolicy: {
      Name: before.restartPolicy.name,
      ...(before.restartPolicy.maximumRetryCount
        ? { MaximumRetryCount: before.restartPolicy.maximumRetryCount }
        : {}),
    },
  });
}

/** Wait until the control plane moves the row into one of `states`. */
async function waitFor(resourceId: string, states: string[]): Promise<MigrationRow> {
  const deadline = now() + WAIT_MS;
  for (;;) {
    const row = await migrationRow(resourceId);
    if (
      row.isOk() &&
      row.value &&
      (states.includes(row.value.state) || row.value.state === "failed")
    ) {
      return row.value;
    }
    if (now() >= deadline)
      throw new Error(`the control plane did not answer within ${WAIT_MS / 1000}s`);
    await sleep(500);
  }
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** What the migration of one resource will do, from a fresh preflight; null when already done. */
async function planFor(docker: Docker, resourceId: string) {
  const report = (await preflight(docker)).unwrap();
  const r = report.resources.find((x) => x.resourceId === resourceId);
  if (!r) throw new Error(`resource ${resourceId} is not deployable`);
  if (r.action === "blocked") throw new Error(r.blockers.join("; "));
  if (r.action === "done") return null;
  const node = (await buildHostNode()).unwrap();
  if (!node) throw new Error("this host has no enrolled otterd node");
  const before = r.containerId ? await beforeImage(docker, r.containerId) : null;
  const target = await migrationSpecFor(resourceId, node, before?.image ?? r.image ?? "");
  if (target.isErr()) throw new Error(target.error);
  return { node, before, target: target.value };
}

async function adoptSteps(docker: Docker, sessionId: string, resourceId: string, by: string) {
  const plan = await planFor(docker, resourceId);
  if (!plan) return "already on otterd";
  const { node, before, target } = plan;
  const fields = {
    nodeId: node,
    serviceName: target.serviceName,
    containerId: before?.containerId ?? null,
    beforeImage: before,
  };
  (await holdResource(sessionId, resourceId, fields, now())).unwrap();
  (await putService(target.spec, now(), target.serviceName)).unwrap();
  if (!before) {
    (await stepResource(resourceId, "migrated", now(), { owner: "otterd" })).unwrap();
    return `owner switched by ${by}; nothing was running`;
  }
  const disabled = await Result.tryPromise({
    try: () => disableRestart(docker, before),
    catch: message,
  });
  if (disabled.isErr()) {
    // Compensate in place: the container is the legacy runtime's again, as it was.
    await restoreRestart(docker, before);
    await forgetService(resourceId);
    await stepResource(resourceId, "rolled-back", now(), {
      owner: "legacy",
      error: disabled.error,
    });
    throw new Error(disabled.error);
  }
  (await stepResource(resourceId, "restart-disabled", now())).unwrap();
  (await stepResource(resourceId, "adopt-requested", now())).unwrap();
  const done = await waitFor(resourceId, ["adopted"]);
  if (done.state !== "adopted") {
    // Refused with no side effects: the node never took it, so it goes back as it was.
    if (await neverAdopted(done)) await giveBackUnadopted(docker, done);
    throw new Error(done.error ?? "adoption failed; the resource stays held");
  }
  (await stepResource(resourceId, "migrated", now(), { owner: "otterd" })).unwrap();
  return `adopted ${before.containerId.slice(0, 12)} in place`;
}

export async function migrateResource(docker: Docker, resourceId: string, by: string) {
  const session = await currentSession();
  if (session.isErr() || session.value?.state !== "open") {
    return Result.err("no open migration session");
  }
  const sessionId = session.value.sessionId;
  return Result.tryPromise({
    try: () => adoptSteps(docker, sessionId, resourceId, by),
    catch: message,
  });
}

/** The adoption grant is gone or retired: no node holds the container. */
async function neverAdopted(row: MigrationRow): Promise<boolean> {
  if (!row.grantId) return true;
  const g = (await grantRow(row.grantId)).unwrap();
  return !g || g.state === "released";
}

/** A container the migration never adopted, given back exactly as it was. */
async function giveBackUnadopted(docker: Docker, row: MigrationRow): Promise<string> {
  if (row.beforeImage) await restoreRestart(docker, row.beforeImage);
  await forgetService(row.resourceId);
  (await stepResource(row.resourceId, "rolled-back", now(), { owner: "legacy" })).unwrap();
  return "never adopted; given back as it was";
}

async function rollbackSteps(docker: Docker, resourceId: string) {
  const row = (await migrationRow(resourceId)).unwrap();
  if (!row || (row.state !== "migrated" && row.state !== "failed")) {
    throw new Error(`resource ${resourceId} is not migrated`);
  }
  if (row.state === "failed" && (await neverAdopted(row))) return giveBackUnadopted(docker, row);
  (await stepResource(resourceId, "release-requested", now(), { owner: "migrating" })).unwrap();
  const done = await waitFor(resourceId, ["released"]);
  if (done.state !== "released") throw new Error(done.error ?? "the node did not give it back");
  await forgetService(resourceId);
  (await stepResource(resourceId, "rolled-back", now(), { owner: "legacy" })).unwrap();
  return "given back to the legacy runtime";
}

export async function rollbackResource(docker: Docker, resourceId: string) {
  const session = await currentSession();
  if (session.isErr() || session.value?.state !== "open") {
    return Result.err("rollback needs the session open (it is not finalized)");
  }
  return Result.tryPromise({ try: () => rollbackSteps(docker, resourceId), catch: message });
}

/** Finalize once every container is otterd's and nothing is mid-step. */
export async function finalize(docker: Docker) {
  return Result.tryPromise({
    try: async () => {
      const session = (await currentSession()).unwrap();
      if (session?.state !== "open") throw new Error("no open migration session");
      const busy = (await allRows())
        .unwrap()
        .filter((r) => !["migrated", "rolled-back"].includes(r.state));
      if (busy.length > 0)
        throw new Error(`still moving: ${busy.map((r) => r.resourceId).join(", ")}`);
      const report = (await preflight(docker)).unwrap();
      const left = report.resources.filter((r) => r.action === "adopt" || r.action === "blocked");
      if (left.length > 0) {
        throw new Error(`still on the legacy runtime: ${left.map((r) => r.name).join(", ")}`);
      }
      (await setSessionState(session.sessionId, "finalized", now())).unwrap();
      return session.sessionId;
    },
    catch: message,
  });
}
