/**
 * The otterd-backed runtime driver. It never talks to Docker or to a node:
 * it writes the desired service through the otterd store (a new revision
 * when the spec changed), and the control plane's scheduler, running in its
 * own process, places, grants and rolls it out. `provision`/`update` then
 * wait for the target revision to run (or fail) and report like the other
 * drivers; `inspect` reads the scheduler's state.
 *
 * The build worker hands images over the same way (`redeployOne` →
 * `runtime().update`): the built image reference, its digest when it was
 * pushed, and the wait on the rollout. A registry-less build stays on the
 * build host (see `placementOf`).
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
import {
  type ServiceStatus,
  buildHostNode,
  claimForOtterd,
  failureText,
  pinOf,
  statusByName,
} from "../otterd/store/status";
import { type Placement, databaseToSpec, serviceToSpec } from "../otterd/translate";
import { isLocalImage } from "../swarm/local-image-placement";

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
  errorMessage:
    s.status !== "error"
      ? null
      : s.failure
        ? failureText(s.failure)
        : "a new attempt exited; see the service's logs",
});

/** The resource's pinned server as an otterd node; a pin with no enrolled node is refused. */
async function pinnedNode(resourceId: string): Promise<Placement> {
  const pin = await pinOf(resourceId);
  if (pin.isErr()) throw new OtterdRuntimeError(pin.error.message);
  if (!pin.value.pinned) return { nodeId: null };
  if (pin.value.nodeId === null) {
    throw new OtterdRuntimeError(`server ${pin.value.serverId} has no enrolled otterd node`, 409);
  }
  return { nodeId: pin.value.nodeId };
}

/**
 * Where the resource may run. A registry-less image the builder produced
 * exists only on the build host, and no node can fetch it from anywhere
 * else, so it runs there: unpinned, it is pinned to the build host, and a
 * pin to another server is refused until the image goes to a registry.
 */
export async function placementOf(resourceId: string, image: string | null): Promise<Placement> {
  const pinned = await pinnedNode(resourceId);
  if (image === null || !isLocalImage(image)) return pinned;
  const host = await buildHostNode();
  if (host.isErr()) throw new OtterdRuntimeError(host.error.message);
  if (host.value === null) {
    throw new OtterdRuntimeError(
      `${image} was built locally, but no build host node is enrolled`,
      409,
    );
  }
  if (pinned.nodeId !== null && pinned.nodeId !== host.value) {
    throw new OtterdRuntimeError(
      `${image} exists only on the build host; set an image repository to run it on another server`,
      409,
    );
  }
  return { nodeId: host.value };
}

async function apply(
  resource: { resourceId: string; serviceName: string; image: string | null },
  translate: (placement: Placement) => ReturnType<typeof serviceToSpec>,
  waitMs: number,
): Promise<ServiceStatus> {
  const { resourceId, serviceName } = resource;
  const translated = translate(await placementOf(resourceId, resource.image));
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
    const s = await apply(spec, (placement) => serviceToSpec(spec, placement), SERVICE_WAIT_MS);
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
      { resourceId: input.resourceId, serviceName: input.serviceName, image: input.image ?? null },
      (p) => databaseToSpec(input, p),
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
