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
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import type { ProvisionSwarmDatabaseInput, SwarmDatabaseRuntime } from "../swarm/database";
import type { SwarmServiceRuntime, SwarmServiceSpec } from "../swarm/service";

/** A container to run — same shape the swarm path already produces. */
export type ContainerSpec = SwarmServiceSpec;
/** Live status of a running service/container. */
export type RuntimeStatus = SwarmServiceRuntime;
/** A database container to run. */
export type DatabaseSpec = ProvisionSwarmDatabaseInput;
/** Live status of a running database. */
export type DatabaseStatus = SwarmDatabaseRuntime;

/**
 * Spec for provisioning a COW branch of an existing database. It IS a normal
 * `DatabaseSpec` (the branch carries its own distinct serviceName / volumeName /
 * hostnameAlias / resourceId, and — on the `copy` path — FRESH credentials),
 * plus the source's identity so the driver can locate the data to clone/copy.
 * See docs/designs/pr-previews.md §4.4/§4.5.
 */
export type BranchDatabaseSpec = DatabaseSpec & {
  /** Running source DB container name to branch from. */
  sourceServiceName: string;
  /** Source resource id — resolves the source volume via volumeDir on the COW path. */
  sourceResourceId: ResourceId;
  /** How to materialize the branch: `zfs` (volume clone) or `copy` (dump+restore). */
  strategy: "zfs" | "copy";
  /** ZFS snapshot ref, when the SnapshotDriver produced one (null on `copy`). */
  snapshotRef?: string | null;
  /**
   * Source DB credentials — required by the `copy` strategy's `pg_dump` (the
   * branch itself carries its own FRESH creds on the base DatabaseSpec fields,
   * per §4.4). Unused by `zfs`, whose clone boots on the source's PGDATA and so
   * keeps the source creds. NOTE: this field is a P2 addition on top of the
   * design's BranchDatabaseSpec sketch — the P4/P5 caller supplies it from the
   * source `databaseResource` row.
   */
  sourceCredentials?: { databaseName: string; username: string; password: string };
};

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
  /**
   * Batched `inspect` — resolve MANY services' live status in ONE runtime
   * round-trip. List endpoints call this instead of N per-service `inspect`s,
   * each of which opened a fresh Docker connection + lookup (the list N+1).
   * Keyed by serviceName; a service with no live container maps to a `missing`
   * status, exactly as a single `inspect` on an absent container would.
   */
  inspectMany(
    inputs: ReadonlyArray<{ serviceName: string; projectSlug: string }>,
    log?: RequestLogger,
  ): Promise<Map<string, RuntimeStatus>>;

  // ── Databases (single-replica stateful containers) ──
  provisionDatabase(input: DatabaseSpec, log?: RequestLogger): Promise<DatabaseStatus>;
  updateDatabase(input: DatabaseSpec, log?: RequestLogger): Promise<DatabaseStatus>;
  destroyDatabase(input: { serviceName: string }, log?: RequestLogger): Promise<void>;
  inspectDatabase(
    input: { serviceName: string; volumeName: string; projectSlug: string },
    log?: RequestLogger,
  ): Promise<DatabaseStatus>;

  // ── Database branching (copy-on-write, per preview env) ──
  /** Provision a branch of a running source database (§4.5). */
  branchDatabase(input: BranchDatabaseSpec, log?: RequestLogger): Promise<DatabaseStatus>;
  /** Tear a branch down — container AND volume AND snapshot (branches, unlike a
   *  normal DB teardown, are NOT orphaned). Volume resolves via the branch's
   *  own (projectId, resourceId). */
  destroyDatabaseBranch(
    input: {
      serviceName: string;
      projectId: ProjectId;
      resourceId: ResourceId;
      snapshotRef: string | null;
    },
    log?: RequestLogger,
  ): Promise<void>;
}
