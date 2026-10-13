import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The otterd control plane's durable authority: node membership,
 * normalized service specifications, slots with their generation
 * high-water, grants, positive-retirement evidence, fences, the commands sent
 * to nodes and a journal of every scheduler decision.
 *
 * Postgres is the single authority. Two rules are enforced here, not only in
 * code: a slot's generation high-water only rises (the store takes the slot
 * row lock), and an exclusive slot never has two grants that are not
 * Released (a partial unique index). Grant and evidence rows are never
 * deleted: they are the safety history a re-enrollment or recovery reads.
 *
 * Every time column is integer epoch milliseconds, as in the health tables.
 */

/** This install's issuing authority: the term every grant and capability carries. */
export const otterdAuthority = pgTable("otterd_authority", {
  installId: text("install_id").primaryKey(),
  authorityTerm: integer("authority_term").notNull(),
  /** Enrollment sequence committed in the off-node anchor, when one is configured. */
  anchorSeq: integer("anchor_seq"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** Single-use, short-lived enrollment tokens; only the SHA-256 is stored. */
export const otterdEnrollToken = pgTable("otterd_enroll_token", {
  tokenId: text("token_id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  roles: jsonb("roles").$type<string[]>().notNull(),
  labels: jsonb("labels").$type<Record<string, string>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
  usedByNode: text("used_by_node"),
});

/**
 * One enrolled node. A re-enrollment raises `node_epoch`; the session columns
 * describe the live control session, if any. Liveness is derived from
 * `last_evidence_at` (the last authenticated frame), never stored as a state.
 */
export const otterdNode = pgTable(
  "otterd_node",
  {
    nodeId: text("node_id").primaryKey(),
    /** Enrollment order: the index of the node's global slots. */
    ordinal: integer("ordinal").notNull(),
    nodeEpoch: integer("node_epoch").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    identityKey: text("identity_key").notNull(),
    identityKeyId: text("identity_key_id").notNull(),
    roles: jsonb("roles").$type<string[]>().notNull(),
    labels: jsonb("labels").$type<Record<string, string>>().notNull(),
    arch: text("arch").notNull(),
    host: jsonb("host").$type<Record<string, unknown>>().notNull(),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull(),
    allocatableNanoCpus: bigint("allocatable_nano_cpus", { mode: "number" }).notNull(),
    allocatableMemoryBytes: bigint("allocatable_memory_bytes", { mode: "number" }).notNull(),
    /** active | cordoned | draining | retired */
    admin: text("admin").notNull().default("active"),
    /** Committed off-node inventory sequence (append-before-capability). */
    anchorSeq: integer("anchor_seq"),
    fenceAdapter: text("fence_adapter"),
    /** Off until an install admin enables it with the blast radius shown. */
    fenceEnabled: boolean("fence_enabled").notNull().default(false),
    fenceBinding: jsonb("fence_binding").$type<Record<string, unknown>>(),
    lastEvidenceAt: bigint("last_evidence_at", { mode: "number" }),
    sessionId: text("session_id"),
    incarnation: text("incarnation"),
    bootId: text("boot_id"),
    /** The session whose first slot report has arrived; a restarted node's grants wait for it. */
    reportedSession: text("reported_session"),
    peerFreshUntil: bigint("peer_fresh_until", { mode: "number" }),
    /** queued | draining | upgrading | rejoining | done */
    upgradePhase: text("upgrade_phase"),
    upgradeFromIncarnation: text("upgrade_from_incarnation"),
    upgradeSince: bigint("upgrade_since", { mode: "number" }),
    /** The signed release the rolling upgrade sends this node (`node.upgrade`). */
    upgradeRelease: jsonb("upgrade_release").$type<Record<string, unknown>>(),
    /**
     * After a fence: the epoch the node still holds until it accepts its
     * re-enrollment certificate over one recovery session.
     */
    recoveryEpoch: integer("recovery_epoch"),
    reenrollCertificate: jsonb("reenroll_certificate").$type<Record<string, unknown>>(),
    enrolledAt: bigint("enrolled_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("otterd_node_ordinal").on(t.ordinal)],
);

/** A scheduled service: the revision every slot should run. */
export const otterdService = pgTable(
  "otterd_service",
  {
    resourceId: text("resource_id").primaryKey(),
    /** The runtime service name the deploy layer addresses it by (`od-<project>-<name>…`). */
    serviceName: text("service_name"),
    revision: integer("revision").notNull(),
    stableRevision: integer("stable_revision"),
    paused: boolean("paused").notNull().default(false),
    /** Node holding a `stay` service's data, set at its first placement. */
    homeNode: text("home_node"),
    rolloutPaused: boolean("rollout_paused").notNull().default(false),
    lastSlotUpdatedAt: bigint("last_slot_updated_at", { mode: "number" }),
    /** Highest operation epoch issued for this resource (I2, node high-water). */
    operationEpoch: integer("operation_epoch").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("otterd_service_name").on(t.serviceName)],
);

/** Every normalized specification a service ever had; a rollback is a new revision. */
export const otterdServiceRevision = pgTable(
  "otterd_service_revision",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => otterdService.resourceId, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.revision] })],
);

/** A slot and its durable, monotonic generation high-water (I2). Locked by admission. */
export const otterdSlot = pgTable(
  "otterd_slot",
  {
    resourceId: text("resource_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    generationHighWater: integer("generation_high_water").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.slotIndex] })],
);

/**
 * Start authority for one slot generation on one node epoch and incarnation.
 * `prepared` has never left the control plane; anything after it keeps its
 * ownership barrier until positive retirement evidence releases it.
 */
export const otterdGrant = pgTable(
  "otterd_grant",
  {
    grantId: text("grant_id").primaryKey(),
    resourceId: text("resource_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    generation: integer("generation").notNull(),
    authorityTerm: integer("authority_term").notNull(),
    nodeId: text("node_id")
      .notNull()
      .references(() => otterdNode.nodeId),
    nodeEpoch: integer("node_epoch").notNull(),
    incarnation: text("incarnation").notNull(),
    exclusive: boolean("exclusive").notNull(),
    specRevision: integer("spec_revision").notNull(),
    /** prepared | granted | starting | running | stopping | released | unknown */
    state: text("state").notNull(),
    orphan: boolean("orphan").notNull().default(false),
    surge: boolean("surge").notNull().default(false),
    operationEpoch: integer("operation_epoch").notNull(),
    /** The `workload.apply` operation that carries this grant. */
    opId: text("op_id").notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    stopRequestedAt: bigint("stop_requested_at", { mode: "number" }),
    sentAt: bigint("sent_at", { mode: "number" }),
    releasedAt: bigint("released_at", { mode: "number" }),
    releaseEvidenceId: text("release_evidence_id"),
    /** Every attempt id the node reported for this grant. */
    attempts: jsonb("attempts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    runningSince: bigint("running_since", { mode: "number" }),
    failed: boolean("failed").notNull().default(false),
    /** The attempt a restarted node kept for this grant, awaiting confirmation. */
    heldAttempt: text("held_attempt"),
    /** For an adopting grant: the held attempt it re-binds (same container). */
    adoptsAttempt: text("adopts_attempt"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("otterd_grant_slot_generation").on(t.resourceId, t.slotIndex, t.generation),
    // I1: one grant that is not Released per exclusive slot, whatever the code does.
    uniqueIndex("otterd_grant_one_live_exclusive")
      .on(t.resourceId, t.slotIndex)
      .where(sql`${t.exclusive} and ${t.state} <> 'released'`),
    index("otterd_grant_live_by_node")
      .on(t.nodeId)
      .where(sql`${t.state} <> 'released'`),
  ],
);

/**
 * Verified positive retirement: a node-signed stop certificate for one grant,
 * or barrier evidence (provider power-off, manual fence) for one node epoch.
 */
export const otterdEvidence = pgTable(
  "otterd_evidence",
  {
    evidenceId: text("evidence_id").primaryKey(),
    /** stop-certificate | provider-power-off | manual-fence | refused | adoption */
    kind: text("kind").notNull(),
    nodeId: text("node_id").notNull(),
    nodeEpoch: integer("node_epoch").notNull(),
    /** The grant a stop certificate retires; null for a node barrier. */
    grantId: text("grant_id"),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    observedAt: bigint("observed_at", { mode: "number" }).notNull(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("otterd_evidence_node").on(t.nodeId, t.nodeEpoch),
    uniqueIndex("otterd_evidence_grant")
      .on(t.grantId)
      .where(sql`${t.grantId} is not null`),
  ],
);

/** Fence attempts; at most one in flight per node epoch. */
export const otterdFence = pgTable(
  "otterd_fence",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    nodeId: text("node_id").notNull(),
    nodeEpoch: integer("node_epoch").notNull(),
    adapter: text("adapter").notNull(),
    /** Revocation of every grant on the node committed before the request. */
    revokedAt: bigint("revoked_at", { mode: "number" }).notNull(),
    requestedAt: bigint("requested_at", { mode: "number" }).notNull(),
    /** requested | succeeded | failed */
    state: text("state").notNull(),
    evidenceId: text("evidence_id"),
    error: text("error"),
    finishedAt: bigint("finished_at", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("otterd_fence_in_flight")
      .on(t.nodeId, t.nodeEpoch)
      .where(sql`${t.state} = 'requested'`),
  ],
);

/** Commands sent to nodes, claimed before sending; a retry reuses its op id. */
export const otterdCommand = pgTable(
  "otterd_command",
  {
    opId: text("op_id").primaryKey(),
    nodeId: text("node_id").notNull(),
    verb: text("verb").notNull(),
    payloadHash: text("payload_hash").notNull(),
    grantId: text("grant_id"),
    operationEpoch: integer("operation_epoch").notNull(),
    /** sent | completed | failed | unknown */
    state: text("state").notNull(),
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    sentAt: bigint("sent_at", { mode: "number" }).notNull(),
    answeredAt: bigint("answered_at", { mode: "number" }),
  },
  (t) => [index("otterd_command_grant").on(t.grantId)],
);

/** Every scheduler and failover decision, with its reason, in order. */
export const otterdDecision = pgTable(
  "otterd_decision",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: bigint("at", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    resourceId: text("resource_id"),
    slotIndex: integer("slot_index"),
    nodeId: text("node_id"),
    grantId: text("grant_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    index("otterd_decision_resource").on(t.resourceId, t.at),
    index("otterd_decision_node").on(t.nodeId, t.at),
  ],
);
