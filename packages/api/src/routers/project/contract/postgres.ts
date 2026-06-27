/**
 * Postgres-specific contract surface.
 *
 * Engine-specific create + setPublic + env editing. Reads / deletes / generic
 * env list use the kind-agnostic endpoints in `./resource`. The streaming
 * create yields a discriminated-union progress event per provisioning step
 * so the wizard renders a live checklist instead of hanging on a spinner.
 */

import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";

import { postgresResourceSchema } from "./resource";
import { basePath, resourceNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

// Env-key shape — Postgres-image friendly (libc convention). The derived
// POSTGRES_USER / PASSWORD / DB keys are reserved: setting them via the editor
// is rejected so the database identity stays a single source of truth.
const POSTGRES_RESERVED_ENV_KEYS = new Set(["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]);
const envKeyShape = z
  .string()
  .min(1)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "must be UPPER_SNAKE_CASE")
  .refine((k) => !POSTGRES_RESERVED_ENV_KEYS.has(k), {
    message:
      "POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD are reserved — use the rotation flow to change credentials.",
  });

export const setPostgresExtraEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: envKeyShape,
  value: z.string().max(8192),
});

export const unsetPostgresExtraEnvInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  key: envKeyShape,
});

const restartPostgresInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

export const createPostgresDatabaseInput = z.object({
  projectId: projectIdField,
  name: z.string().min(1),
  /** Database engine to provision. Default is postgres for back-compat
   *  with the original postgres-only contract; the wizard sends the
   *  user's selection explicitly. */
  engine: z
    .enum([
      "postgres",
      "redis",
      "mariadb",
      "mongodb",
      "clickhouse",
      "rabbitmq",
      "minio",
      "meilisearch",
    ])
    .optional()
    .default("postgres"),
  /** Whether the DB should be reachable from the public internet via the
   *  Caddy proxy. Defaults to false — internal-only is the safe default.
   *  Currently only honoured for postgres (other engines stay internal
   *  until their TCP proxy paths are wired). */
  publicEnabled: z.boolean().optional().default(false),
});

/**
 * One event in the postgres create stream. The handler yields these as it
 * walks the provisioning steps, so the wizard renders a live checklist
 * instead of hanging on a spinner. The final `done` event carries the
 * fully-mapped resource so the client can route to the detail panel.
 */
export const createPostgresProgressSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    /** Step identifier — matches the log.info step names emitted by the
     *  underlying provisioner (`ensure-network`, `service-create`,
     *  `wait-ready`, …). */
    step: z.string(),
    /** Step transition: `start` when the step begins, `ok` on success,
     *  `tick` for in-progress updates (e.g. wait-ready polling), `error`
     *  on failure. */
    status: z.enum(["start", "ok", "tick", "error"]),
    /** Human-readable detail — surfaced verbatim in the wizard UI. */
    message: z.string().nullable(),
  }),
  z.object({
    type: z.literal("pull"),
    /** Image being pulled (e.g. `postgres:18-alpine`). */
    image: z.string(),
    /** Docker layer id this event refers to. Some events (like the initial
     *  `Pulling from library/postgres`) have no layer id — represented as
     *  `null`. */
    id: z.string().nullable(),
    /** Docker status string — `Pulling fs layer`, `Downloading`,
     *  `Extracting`, `Pull complete`, `Already exists`, etc. */
    status: z.string(),
    /** Human-readable progress bar (`[==>  ]  12.3MB/45.6MB`) when docker
     *  emits one. */
    progress: z.string().nullable(),
    /** Bytes processed so far for this layer. */
    current: z.number().nullable(),
    /** Total bytes for this layer (may be 0 until docker knows the size). */
    total: z.number().nullable(),
  }),
  z.object({
    type: z.literal("log"),
    /** Container output captured during the wait-ready window — gives the
     *  operator visibility into postgres' own startup messages
     *  (`database system is ready to accept connections`). Ends when the
     *  service reports ready or the wait window expires. */
    stream: z.enum(["stdout", "stderr"]),
    line: z.string(),
  }),
  z.object({
    /** Emitted as soon as the resource row is persisted — earlier than
     *  `done`, which only fires after caddy reconcile + any post-create
     *  bookkeeping. The wizard uses this to close the modal immediately
     *  and hand the user off to the resource page; the stream continues
     *  in the background until `done`. */
    type: z.literal("created"),
    resource: postgresResourceSchema,
  }),
  z.object({
    type: z.literal("done"),
    resource: postgresResourceSchema,
  }),
  z.object({
    type: z.literal("error"),
    /** Terminal failure — the stream ends after this event and no `done`
     *  follows. */
    code: z.string(),
    message: z.string(),
  }),
]);

/** Flip the public-exposure flag on an existing postgres resource. The
 *  Caddy reconciler runs after the toggle so the route state catches up. */
export const setPostgresPublicInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  publicEnabled: z.boolean(),
});

/** Replace the full set of enabled extensions on a postgres resource. The
 *  handler persists the list, rolls the service (image may change for
 *  non-contrib extensions like postgis/pgvector), then runs CREATE/DROP
 *  EXTENSION against the live database. */
const setPostgresExtensionsInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** Canonical CREATE EXTENSION names (e.g. "pgcrypto", "vector"). Unknown
   *  names are rejected; the desired set fully replaces the current one. */
  extensions: z.array(z.string()).max(32),
});

/** Mint (or read) the credentials for a database STAGED in the manifest but not
 *  yet provisioned. A database's identity is deterministic from its name; the
 *  password is minted once and reused at deploy. Lets the pending panel show
 *  real connection details before the container exists. */
const draftCredentialsInput = z.object({
  projectId: projectIdField,
  /** Manifest resource name (the `databases[name]` key). */
  name: z.string().min(1),
  engine: z
    .enum([
      "postgres",
      "redis",
      "mariadb",
      "mongodb",
      "clickhouse",
      "rabbitmq",
      "minio",
      "meilisearch",
    ])
    .optional()
    .default("postgres"),
});

const draftCredentialsOutput = z.object({
  username: z.string(),
  password: z.string(),
  databaseName: z.string(),
  internalHostname: z.string(),
  internalPort: z.number().int(),
  internalConnectionString: z.string(),
});

export const postgresContractSlice = {
  // Streaming create — yields per-step progress events as the
  // provision walks. The final `done` event carries the mapped
  // resource; the wizard routes to the detail panel on receiving it.
  // Errors during provision yield a terminal `error` event rather
  // than throwing (the contract's NOT_FOUND/CONFLICT still apply to
  // failures BEFORE the stream begins, e.g. project missing).
  create: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Project not found" as const },
      CONFLICT: {
        status: 409,
        message: "Database resource already exists" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres`,
      tag,
      method: "POST",
    })
    .input(createPostgresDatabaseInput)
    .output(eventIterator(createPostgresProgressSchema)),

  // Mint/read the staged credentials for a not-yet-provisioned database.
  // POST because it writes (mints the password on first call); the client
  // still reads it via queryOptions, like manifest.diff.
  draftCredentials: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Project not found" as const },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/database/draft-credentials`,
      tag,
      method: "POST",
    })
    .input(draftCredentialsInput)
    .output(draftCredentialsOutput),

  setPublic: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/public`,
      tag,
      method: "PATCH",
    })
    .input(setPostgresPublicInput)
    .output(postgresResourceSchema),

  // Re-roll the running database with its current spec — same image, env, and
  // public flag. Forces swarm to schedule a fresh task (and re-applies the
  // container labels, so a DB created before a label change picks it up).
  restart: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/restart`,
      tag,
      method: "POST",
    })
    .input(restartPostgresInput)
    .output(postgresResourceSchema),

  setExtensions: oc
    .errors({
      ...resourceNotFoundErrors,
      INVALID_INPUT: {
        status: 400,
        message: "Unknown or incompatible extensions" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/extensions`,
      tag,
      method: "PUT",
    })
    .input(setPostgresExtensionsInput)
    .output(postgresResourceSchema),

  setExtraEnv: oc
    .errors({
      ...resourceNotFoundErrors,
      INVALID_INPUT: {
        status: 400,
        message: "Invalid env key or value" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/env/{key}`,
      tag,
      method: "PUT",
    })
    .input(setPostgresExtraEnvInput)
    .output(postgresResourceSchema),

  unsetExtraEnv: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/env/{key}`,
      tag,
      method: "DELETE",
    })
    .input(unsetPostgresExtraEnvInput)
    .output(postgresResourceSchema),
};
