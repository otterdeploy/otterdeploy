/**
 * Build pipeline schema — container registries and deployment logs.
 *
 * The build pipeline (apps/builder) consumes the queue jobs already emitted
 * by the Phase 1 git webhook receiver, clones the repo at the push SHA,
 * runs `nixpacks build`, and pushes the resulting image to whichever
 * registry the project points at.
 *
 * Two tables live here:
 *
 *   container_registry — per-org credentials used both by the builder
 *     (to `docker push`) and by `resolveRegistryAuth` (so the swarm
 *     daemon can `docker pull` the same image at deploy time). Passwords
 *     are stored encrypted via `encryptSecret` (HKDF-derived AES-GCM
 *     keyed off BETTER_AUTH_SECRET — see packages/api/src/lib/crypto.ts).
 *
 *   deployment_log — append-only stream of build-time output. Each row
 *     is a single line so the UI can paginate and the live tail (Redis
 *     pub/sub channel) can replay missed lines without scanning a JSONB
 *     blob. Rows are written by the builder; the platform never edits.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import type { ContainerRegistryId, DeploymentId } from "@otterdeploy/shared/id";

import {
  bigserial,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { deployment } from "./project";

export const containerRegistryAuthEnum = pgEnum(
  "container_registry_auth",
  ["password", "token"],
);

/**
 * One row per (org, host, username). Multiple users on the same host are
 * supported — an org might keep a CI bot account separate from a personal
 * one — but the (host, username) pair must be unique within an org so the
 * UI can present a stable "default" credential per host.
 *
 * `encryptedPassword` is the AES-GCM ciphertext + nonce blob as a base64url
 * string. Never log this column.
 */
export const containerRegistry = pgTable(
  "container_registry",
  {
    id: text("id")
      .primaryKey()
      .$type<ContainerRegistryId>()
      .$defaultFn(() => createId(ID_PREFIX.containerRegistry)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Operator-visible label, e.g. "GHCR (ci-bot)". */
    displayName: text("display_name").notNull(),
    /** Registry hostname — "ghcr.io", "docker.io", "registry:5000". */
    host: text("host").notNull(),
    /** Username/login (or the literal "x-access-token" for some hosts). */
    username: text("username").notNull(),
    /** Encrypted password or PAT. See packages/api/src/lib/crypto.ts. */
    encryptedPassword: text("encrypted_password").notNull(),
    authType: containerRegistryAuthEnum("auth_type")
      .notNull()
      .default("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("container_registry_org_idx").on(table.organizationId),
    index("container_registry_host_idx").on(table.host),
    uniqueIndex("container_registry_org_host_user_uq").on(
      table.organizationId,
      table.host,
      table.username,
    ),
  ],
);

export const deploymentLogStreamEnum = pgEnum("deployment_log_stream", [
  "stdout",
  "stderr",
  "system",
]);

/**
 * Append-only build/deploy log lines. Keyed on a bigserial so the order
 * matches insertion regardless of clock skew on the writer side; `ts` is
 * still recorded for display.
 *
 * `stream = "system"` is for events the builder emits itself (e.g.
 * "starting nixpacks build", "pushed to ghcr.io/...:abc123"). stdout/stderr
 * are forwarded verbatim from the child process.
 */
export const deploymentLog = pgTable(
  "deployment_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .$type<DeploymentId>()
      .references(() => deployment.id, { onDelete: "cascade" }),
    stream: deploymentLogStreamEnum("stream").notNull(),
    line: text("line").notNull(),
    ts: timestamp("ts").defaultNow().notNull(),
  },
  (table) => [
    // The hot read path is "give me lines for deployment X after seq Y" —
    // a composite (deploymentId, seq) index serves both ordering and
    // pagination cursors in a single scan.
    index("deployment_log_deployment_seq_idx").on(
      table.deploymentId,
      table.seq,
    ),
  ],
);
