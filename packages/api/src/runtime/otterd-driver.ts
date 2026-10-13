/**
 * The otterd-backed runtime driver. It never talks to Docker or to a node:
 * it writes the desired service through the otterd store (a new revision
 * when the spec changed), and the control plane's scheduler, running in its
 * own process, places, grants and rolls it out. `provision`/`update` then
 * wait for the target revision to run (or fail) and report like the other
 * drivers; `inspect` reads the scheduler's state.
 *
 * Selected with `DEPLOY_RUNTIME=otterd`, which only a fresh install sets;
 * resources deployed through it are owned by otterd (`runtime_owner`).
 * Database branching is not offered on otterd yet (501, as on Swarm).
 */
import type { RequestLogger } from "evlog";

import { Temporal } from "@otterdeploy/shared/temporal";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  ContainerSpec,
  DatabaseSpec,
  DatabaseStatus,
  RuntimeDriver,
  RuntimeStatus,
} from "./types";

import { putService, setPaused } from "../otterd/store/services";
import { type ServiceStatus, claimForOtterd, statusByName } from "../otterd/store/status";
import { databaseToSpec, serviceToSpec } from "../otterd/translate";

const now = (): number => Temporal.Now.instant().epochMilliseconds;
const SERVICE_WAIT_MS = 120_000;
const DATABASE_WAIT_MS = 180_000;

class OtterdRuntimeError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

async function statusOf(serviceName: string): Promise<ServiceStatus> {
  const r = await statusByName([serviceName]);
  if (r.isErr()) throw new OtterdRuntimeError(r.error.message);
  return (
    r.value.get(serviceName) ?? {
      resourceId: null,
      revision: null,
      status: "missing",
      running: 0,
      desiredPaused: false,
    }
  );
}

/** Wait until the target revision runs, fails, or the wait runs out (reported as starting). */
async function converge(
  serviceName: string,
  revision: number,
  waitMs: number,
): Promise<ServiceStatus> {
  const deadline = now() + waitMs;
  for (;;) {
    const s = await statusOf(serviceName);
    const settled =
      s.revision === revision &&
      (s.status === "running" || s.status === "error" || s.status === "stopped");
    if (settled || now() >= deadline) return s;
    await sleep(500);
  }
}

const runtimeStatus = (
  serviceName: string,
  networkName: string,
  s: ServiceStatus,
): RuntimeStatus => ({
  serviceId: s.resourceId,
  serviceName,
  networkName,
  status: s.status,
  health: s.status === "running" ? "healthy" : s.status === "starting" ? "starting" : null,
  errorMessage: s.status === "error" ? "a new attempt exited; see the service's logs" : null,
});

async function apply(
  resourceId: string,
  serviceName: string,
  translated: ReturnType<typeof serviceToSpec>,
  waitMs: number,
): Promise<ServiceStatus> {
  if (translated.isErr())
    throw new OtterdRuntimeError(`spec refused: ${translated.error.detail}`, 400);
  const claimed = await claimForOtterd(resourceId);
  if (claimed.isErr()) throw new OtterdRuntimeError(claimed.error.message);
  const spec = translated.value;
  const revision = await putService(spec, now(), serviceName);
  if (revision.isErr()) throw new OtterdRuntimeError(revision.error.message, 409);
  const paused = spec.mode.kind === "replicated" && spec.mode.replicas === 0;
  const p = await setPaused(resourceId, paused, now());
  if (p.isErr()) throw new OtterdRuntimeError(p.error.message);
  return converge(serviceName, revision.value, waitMs);
}

async function stopAndForget(serviceName: string): Promise<void> {
  const s = await statusOf(serviceName);
  if (!s.resourceId) return;
  const p = await setPaused(s.resourceId, true, now());
  if (p.isErr()) throw new OtterdRuntimeError(p.error.message);
}

const scopeOf = (projectSlug: string, suffix?: string) => `${projectSlug}${suffix ?? ""}`;

export const otterdDriver: RuntimeDriver = {
  kind: "otterd",

  async provision(spec: ContainerSpec, _log?: RequestLogger): Promise<RuntimeStatus> {
    const s = await apply(
      spec.resourceId,
      spec.serviceName,
      serviceToSpec(spec, { nodeId: null }),
      SERVICE_WAIT_MS,
    );
    return runtimeStatus(spec.serviceName, scopeOf(spec.projectSlug, spec.networkScopeSuffix), s);
  },
  update(spec: ContainerSpec, log?: RequestLogger): Promise<RuntimeStatus> {
    return otterdDriver.provision(spec, log);
  },
  async destroy(input) {
    await stopAndForget(input.serviceName);
  },
  async inspect(input) {
    return runtimeStatus(
      input.serviceName,
      scopeOf(input.projectSlug, input.networkScopeSuffix),
      await statusOf(input.serviceName),
    );
  },
  async inspectMany(inputs) {
    const r = await statusByName(inputs.map((i) => i.serviceName));
    if (r.isErr()) throw new OtterdRuntimeError(r.error.message);
    const out = new Map<string, RuntimeStatus>();
    for (const i of inputs) {
      const s = r.value.get(i.serviceName);
      if (s)
        out.set(
          i.serviceName,
          runtimeStatus(i.serviceName, scopeOf(i.projectSlug, i.networkScopeSuffix), s),
        );
    }
    return out;
  },

  async provisionDatabase(input: DatabaseSpec): Promise<DatabaseStatus> {
    const s = await apply(
      input.resourceId,
      input.serviceName,
      databaseToSpec(input, { nodeId: null }),
      DATABASE_WAIT_MS,
    );
    return {
      ...runtimeStatus(input.serviceName, scopeOf(input.projectSlug, input.networkScopeSuffix), s),
      volumeName: input.volumeName,
      wasCreated: true,
    };
  },
  updateDatabase(input: DatabaseSpec): Promise<DatabaseStatus> {
    return otterdDriver.provisionDatabase(input);
  },
  async destroyDatabase(input) {
    await stopAndForget(input.serviceName);
  },
  async inspectDatabase(input) {
    return {
      ...runtimeStatus(
        input.serviceName,
        scopeOf(input.projectSlug, input.networkScopeSuffix),
        await statusOf(input.serviceName),
      ),
      volumeName: input.volumeName,
    };
  },

  branchDatabase() {
    return Promise.reject(
      new OtterdRuntimeError("database branching is not available on otterd yet", 501),
    );
  },
  destroyDatabaseBranch() {
    return Promise.reject(
      new OtterdRuntimeError("database branching is not available on otterd yet", 501),
    );
  },
};
