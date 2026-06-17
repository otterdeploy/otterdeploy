/**
 * Runtime-driver abstraction. The deploy layer builds a spec and asks a
 * `RuntimeDriver` to provision/update/destroy/inspect it — without caring
 * whether the backend is plain Docker (default, single-node) or Docker Swarm
 * (opt-in, for scaling across nodes).
 *
 * The spec shapes are the SAME ones the swarm path already builds
 * (`SwarmServiceSpec` / `ProvisionSwarmDatabaseInput`) — re-aliased here under
 * backend-neutral names so call sites read against the abstraction, not Swarm.
 * See docs/designs/runtime.md.
 */
import type { RequestLogger } from "evlog";

import type {
  SwarmServiceRuntime,
  SwarmServiceSpec,
} from "../swarm/service";
import type {
  ProvisionSwarmDatabaseInput,
  SwarmDatabaseRuntime,
} from "../swarm/database";

/** A container to run — same shape the swarm path already produces. */
export type ContainerSpec = SwarmServiceSpec;
/** Live status of a running service/container. */
export type RuntimeStatus = SwarmServiceRuntime;
/** A database container to run. */
export type DatabaseSpec = ProvisionSwarmDatabaseInput;
/** Live status of a running database. */
export type DatabaseStatus = SwarmDatabaseRuntime;

export type RuntimeKind = "docker" | "swarm";

/**
 * One backend that can run containers. Both implementations consume the exact
 * same specs; only the orchestration differs (a swarm service + tasks vs a
 * plain `docker run` container).
 */
export interface RuntimeDriver {
  readonly kind: RuntimeKind;

  // ── Services (and compose-member services) ──
  provision(spec: ContainerSpec, log?: RequestLogger): Promise<RuntimeStatus>;
  update(spec: ContainerSpec, log?: RequestLogger): Promise<RuntimeStatus>;
  destroy(input: { serviceName: string }, log?: RequestLogger): Promise<void>;
  inspect(
    input: { serviceName: string; projectSlug: string },
    log?: RequestLogger,
  ): Promise<RuntimeStatus>;

  // ── Databases (single-replica stateful containers) ──
  provisionDatabase(
    input: DatabaseSpec,
    log?: RequestLogger,
  ): Promise<DatabaseStatus>;
  updateDatabase(
    input: DatabaseSpec,
    log?: RequestLogger,
  ): Promise<DatabaseStatus>;
  destroyDatabase(
    input: { serviceName: string },
    log?: RequestLogger,
  ): Promise<void>;
  inspectDatabase(
    input: { serviceName: string; volumeName: string; projectSlug: string },
    log?: RequestLogger,
  ): Promise<DatabaseStatus>;
}
