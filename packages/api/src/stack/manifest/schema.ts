/**
 * Declarative manifest — JSON-native source of truth for a project's
 * resources. Lives in `project.manifest` (jsonb) and on disk as
 * `otterdeploy.json`. The CLI sends/receives this shape directly via the
 * `manifest.*` oRPC contract.
 *
 * Differences from `../schema.ts` (compose-shaped `StackFile`):
 *   - JSON-first; no docker-compose vocabulary.
 *   - Services and databases live in named maps, not arrays.
 *   - Discriminated unions: service `source` (image|git), database `engine`.
 *   - Environment overrides ride a top-level `environments.<name>` block
 *     and merge deeply onto the base; the compose `StackFile` carries one
 *     rendered environment at a time.
 *
 * Compose YAML is still produced — as a one-way output of the renderer —
 * for docker-stack escape hatch + local-dev use cases.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";

import * as z from "zod";

import type { BuildConfig } from "@otterdeploy/shared/build-config";

import { parseRefs, ManifestRefError } from "./refs";

export const MANIFEST_SCHEMA_VERSION = 1;

// ── Shared primitives ──────────────────────────────────────────────────

/**
 * Env values are plain strings. Refs (`${secret}`, `${database:…}`,
 * `${service:…}`) are valid contents — validated up-front so a typo in the
 * grammar fails fast at manifest validation, not at deploy time.
 */
const envValue = z.string().superRefine((value, ctx) => {
  try {
    parseRefs(value);
  } catch (error) {
    if (error instanceof ManifestRefError) {
      ctx.addIssue({ code: "custom", message: error.message });
    } else {
      throw error;
    }
  }
});

const envMap = z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "env key must be UPPER_SNAKE"), envValue);

const portSchema = z.object({
  container: z.number().int().positive(),
  protocol: z.enum(["tcp", "udp"]).optional(),
  appProtocol: z.enum(["http", "tcp"]).optional(),
  primary: z.boolean().optional(),
  // Optional name; needed for `${service:foo.port.<name>}` references.
  name: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
});

const healthcheckSchema = z.object({
  cmd: z.array(z.string()),
  intervalMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  startMs: z.number().int().nonnegative().optional(),
});

const resourcesSchema = z.object({
  cpuLimit: z.number().nonnegative().optional(),
  memoryMb: z.number().int().positive().optional(),
  cpuReservation: z.number().nonnegative().optional(),
  memoryReservationMb: z.number().int().positive().optional(),
  diskMb: z.number().int().positive().optional(),
  swapMb: z.number().int().positive().optional(),
  pidsLimit: z.number().int().positive().optional(),
});

const restartSchema = z.object({
  condition: z.enum(["none", "on-failure", "any"]),
  maxAttempts: z.number().int().nonnegative().nullable().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  // Window (ms) over which `maxAttempts` is counted when condition is
  // `on-failure`. Matches docker swarm's restart_policy.window. Outside
  // the window, the failure counter resets to zero.
  windowMs: z.number().int().nonnegative().optional(),
});

// Build config — only meaningful for git-sourced services. Discriminated
// by `builder`; each variant carries only the fields that builder
// honors. All path fields are repo-relative; they're applied relative
// to `sourceSubdir` if that's set.
//
// `watchPatterns` is shared across all builders — globs against changed
// paths in a push event; a push only triggers a redeploy if at least
// one path matches. When unset, every push redeploys.
const watchPatterns = z.array(z.string()).optional();

// Auto-detect: inspect the repo (Dockerfile present → dockerfile;
// language markers → nixpacks; else railpack). No other config needed.
const buildAutoSchema = z.object({
  builder: z.literal("auto"),
  watchPatterns,
});

// Dockerfile: build from a Dockerfile in the repo. dockerfilePath
// defaults to ./Dockerfile (relative to sourceSubdir if set).
const buildDockerfileSchema = z.object({
  builder: z.literal("dockerfile"),
  dockerfilePath: z.string().nullable().optional(),
  watchPatterns,
});

// Nixpacks: zero-config builder; buildCommand overrides the detected
// build step. nixpacksConfigPath points at an optional nixpacks.toml.
const buildNixpacksSchema = z.object({
  builder: z.literal("nixpacks"),
  buildCommand: z.string().nullable().optional(),
  nixpacksConfigPath: z.string().nullable().optional(),
  watchPatterns,
});

// Railpack: nixpacks-like, different generator. buildCommand overrides
// the detected build step.
const buildRailpackSchema = z.object({
  builder: z.literal("railpack"),
  buildCommand: z.string().nullable().optional(),
  watchPatterns,
});

// Compose: build/orchestrate from a docker-compose file. composePath
// defaults to ./docker-compose.yml (relative to sourceSubdir if set).
const buildComposeSchema = z.object({
  builder: z.literal("compose"),
  composePath: z.string().nullable().optional(),
  watchPatterns,
});

// Constrained to match the shared `BuildConfig` discriminated union —
// the `satisfies` ensures the zod inferred type stays in lockstep with
// the canonical TS type defined in `@otterdeploy/shared/build-config`.
export const buildSchema = z.discriminatedUnion("builder", [
  buildAutoSchema,
  buildDockerfileSchema,
  buildNixpacksSchema,
  buildRailpackSchema,
  buildComposeSchema,
]) satisfies z.ZodType<BuildConfig>;

// ── Service ─────────────────────────────────────────────────────────────

const serviceCommonSchema = z.object({
  replicas: z.number().int().nonnegative().optional(),
  ports: z.array(portSchema).optional(),
  env: envMap.optional(),
  // Exec-form start command. Array, not string — `["bun", "run", "start"]`
  // not `"bun run start"`. Wrap shell expressions yourself if you need them:
  // `["sh", "-c", "x && y"]`.
  startCommand: z.array(z.string()).nullable().optional(),
  entrypoint: z.array(z.string()).nullable().optional(),
  healthcheck: healthcheckSchema.nullable().optional(),
  resources: resourcesSchema.optional(),
  restart: restartSchema.optional(),
  // Lifecycle hook — runs once after the build finishes but before the
  // new replicas take traffic. Most common use: db migrations. Same
  // exec-form shape as startCommand.
  preDeploy: z.array(z.string()).nullable().optional(),
});

const imageServiceSchema = serviceCommonSchema.extend({
  source: z.literal("image"),
  image: z.string().min(1),
});

const gitServiceSchema = serviceCommonSchema.extend({
  source: z.literal("git"),
  sourceSubdir: z.string().nullable().optional(),
  build: buildSchema.optional(),
});

export const serviceSchema = z.discriminatedUnion("source", [
  imageServiceSchema,
  gitServiceSchema,
]);
export type ServiceManifest = z.infer<typeof serviceSchema>;

// ── Databases ───────────────────────────────────────────────────────────
//
// Engine is the discriminator inside each database block. Each engine has
// its own valid fields; unknown engine-specific keys are rejected.

const databaseCommonSchema = z.object({
  resources: resourcesSchema.optional(),
  publicEnabled: z.boolean().optional(),
  // Extra container env injected alongside the derived POSTGRES_* / etc.
  // Same ref grammar as service env.
  extraEnv: envMap.optional(),
});

const postgresSchema = databaseCommonSchema.extend({
  engine: z.literal("postgres"),
  version: z.string().min(1).optional(),
  extensions: z.array(z.string()).optional(),
});

const redisSchema = databaseCommonSchema.extend({
  engine: z.literal("redis"),
  version: z.string().min(1).optional(),
  maxmemoryPolicy: z
    .enum([
      "noeviction",
      "allkeys-lru",
      "allkeys-lfu",
      "allkeys-random",
      "volatile-lru",
      "volatile-lfu",
      "volatile-random",
      "volatile-ttl",
    ])
    .optional(),
});

const mariadbSchema = databaseCommonSchema.extend({
  engine: z.literal("mariadb"),
  version: z.string().min(1).optional(),
});

const mongodbSchema = databaseCommonSchema.extend({
  engine: z.literal("mongodb"),
  version: z.string().min(1).optional(),
});

export const databaseSchema = z.discriminatedUnion("engine", [
  postgresSchema,
  redisSchema,
  mariadbSchema,
  mongodbSchema,
]);
export type DatabaseManifest = z.infer<typeof databaseSchema>;

// ── Named resource maps ────────────────────────────────────────────────
//
// Identity is the map key (the user-chosen name). Resource names share the
// `resource.name` slug shape — lowercase letters, digits, dashes; starts
// with a letter; <= 63 chars (matches docker service name limits).

const resourceName = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, {
  message: "resource name must be lowercase letters, digits, and dashes; 1–63 chars",
});

const servicesMap = z.record(resourceName, serviceSchema);
const databasesMap = z.record(resourceName, databaseSchema);

// ── Environment overrides ──────────────────────────────────────────────
//
// An environment block can redeclare any service/database with the same
// discriminator. The CLI deep-merges these onto the base before sending.
// Validation is intentionally permissive here — the *merged* result is
// what the server validates strictly. This block validates only that
// keys/types are well-formed, not that they're complete.

const partialServiceSchema = z.union([
  imageServiceSchema.partial(),
  gitServiceSchema.partial(),
  // Permits an override that doesn't declare `source` and just tweaks fields.
  serviceCommonSchema,
]);

const partialDatabaseSchema = z.union([
  postgresSchema.partial(),
  redisSchema.partial(),
  mariadbSchema.partial(),
  mongodbSchema.partial(),
  databaseCommonSchema,
]);

const environmentBlockSchema = z.object({
  services: z.record(resourceName, partialServiceSchema).optional(),
  databases: z.record(resourceName, partialDatabaseSchema).optional(),
});
export type EnvironmentOverride = z.infer<typeof environmentBlockSchema>;

// ── Top-level manifest ─────────────────────────────────────────────────

export const manifestSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(MANIFEST_SCHEMA_VERSION).optional(),
  project: zSlug(ID_PREFIX.project),
  services: servicesMap.default({}),
  databases: databasesMap.default({}),
  environments: z.record(z.string().min(1), environmentBlockSchema).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
