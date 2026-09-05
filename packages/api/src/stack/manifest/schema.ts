import type { BuildConfig } from "@otterdeploy/shared/build-config";

import { BUILD_RUNNERS, DOCKERFILE_CONTEXT_MODES } from "@otterdeploy/shared/build-config";
/**
 * Declarative manifest: JSON-native source of truth for a project's
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
 * Compose YAML is still produced (as a one-way output of the renderer)
 * for docker-stack escape hatch + local-dev use cases.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import * as z from "zod";

import { parseRefs, ManifestRefError } from "./refs";

export const MANIFEST_SCHEMA_VERSION = 1;

// ── Shared primitives ──────────────────────────────────────────────────

/**
 * Env values are plain strings. Refs (`${secret}`, `${database:…}`,
 * `${service:…}`) are valid contents. Validated up-front so a typo in the
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

const envMap = z.record(
  z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "env key must be UPPER_SNAKE"),
  envValue,
);

const portSchema = z.object({
  container: z.number().int().positive(),
  protocol: z.enum(["tcp", "udp"]).optional(),
  appProtocol: z.enum(["http", "tcp"]).optional(),
  primary: z.boolean().optional(),
  // Optional name; needed for `${service:foo.port.<name>}` references.
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
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

// Build config. Only meaningful for git-sourced services. Discriminated
// by `builder`; each variant carries only the fields that builder
// honors. All path fields are repo-relative; they're applied relative
// to `sourceSubdir` if that's set.
//
// `watchPatterns` is shared across all builders. Globs against changed
// paths in a push event; a push only triggers a redeploy if at least
// one path matches. When unset, every push redeploys.
const watchPatterns = z.array(z.string()).optional();

// Auto-detect: inspect the repo (Dockerfile present → dockerfile; else
// railpack). No other config needed.
const buildAutoSchema = z.object({
  builder: z.literal("auto"),
  watchPatterns,
});

// Dockerfile: build from a Dockerfile in the repo. dockerfilePath
// defaults to ./Dockerfile (relative to sourceSubdir if set).
const buildDockerfileSchema = z.object({
  builder: z.literal("dockerfile"),
  dockerfilePath: z.string().nullable().optional(),
  // Where the BUILD CONTEXT is anchored for a Dockerfile inside a monorepo
  // subdir. `auto` reads the Dockerfile's COPY sources and escalates to the
  // repo root only when they demand it; see BuildDockerfileConfig.
  dockerfileContext: z.enum(DOCKERFILE_CONTEXT_MODES).nullable().optional(),
  // Plain `--build-arg key=value` pairs (not secrets, they land in image
  // history). Keys are validated to Docker's arg-name rule so a bad name fails
  // at save time, not opaquely at `docker build`.
  buildArgs: z
    .record(
      z
        .string()
        .regex(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          "build-arg name must start with a letter or underscore and contain only letters, digits, and underscores",
        ),
      z.string(),
    )
    .nullable()
    .optional(),
  watchPatterns,
});

// Railpack: zero-config builder. buildCommand overrides the detected build
// step. For static sites, `spa` enables index.html fallback routing and
// `staticRoot` overrides the served dir (default dist). `packageManager`
// (e.g. "bun@1.3.13", "pnpm@9.12.0") overrides the repo's packageManager field,
// the builder rewrites the workspace-root package.json before building.
const buildRailpackSchema = z.object({
  builder: z.literal("railpack"),
  buildCommand: z.string().nullable().optional(),
  spa: z.boolean().nullable().optional(),
  staticRoot: z.string().nullable().optional(),
  packageManager: z.string().nullable().optional(),
  // Monorepo task runner. Turbo runs OVER a workspace the package manager
  // defined, so these only apply once the repo root is a workspace and the
  // service lives in a subdir of it. `turboFilter` overrides the derived
  // --filter (the app's package name); `turboRemoteCache` opts into Turborepo
  // Remote Cache, reading TURBO_TOKEN from the service's own variables.
  buildRunner: z.enum(BUILD_RUNNERS).nullable().optional(),
  turboFilter: z.string().nullable().optional(),
  turboRemoteCache: z.boolean().nullable().optional(),
  // Build from a `turbo prune`d copy of the workspace: a smaller context and a
  // narrower install. Opt-in, and skipped automatically when it would drop
  // root-level config the build may need.
  turboPrune: z.boolean().nullable().optional(),
  watchPatterns,
});

// Compose: build/orchestrate from a docker-compose file. composePath
// defaults to ./docker-compose.yml (relative to sourceSubdir if set).
const buildComposeSchema = z.object({
  builder: z.literal("compose"),
  composePath: z.string().nullable().optional(),
  watchPatterns,
});

// Constrained to match the shared `BuildConfig` discriminated union:
// the `satisfies` ensures the zod inferred type stays in lockstep with
// the canonical TS type defined in `@otterdeploy/shared/build-config`.
export const buildSchema = z.discriminatedUnion("builder", [
  buildAutoSchema,
  buildDockerfileSchema,
  buildRailpackSchema,
  buildComposeSchema,
]) satisfies z.ZodType<BuildConfig>;

// ── Service ─────────────────────────────────────────────────────────────

const serviceCommonSchema = z.object({
  replicas: z.number().int().nonnegative().optional(),
  ports: z.array(portSchema).optional(),
  env: envMap.optional(),
  /** Keys in `env` the operator marked sensitive. A display flag, not storage:
   *  values are encrypted either way. It lives here because apply REPLACES the
   *  env rows, and without a declaration every apply re-inserted them
   *  unflagged — an explicit "this is a secret" toggle survived until the next
   *  apply and then silently fell back to key-name heuristics (od-w2r). */
  secrets: z.array(z.string().min(1)).optional(),
  // Exec-form start command. Array, not string. `["bun", "run", "start"]`
  // not `"bun run start"`. Wrap shell expressions yourself if you need them:
  // `["sh", "-c", "x && y"]`.
  startCommand: z.array(z.string()).nullable().optional(),
  entrypoint: z.array(z.string()).nullable().optional(),
  healthcheck: healthcheckSchema.nullable().optional(),
  resources: resourcesSchema.optional(),
  restart: restartSchema.optional(),
  // Lifecycle hooks. Exec-form, run in order, each in a throwaway
  // container off the new image. preDeploy runs after the build but
  // before the new replicas take traffic (db migrations); postDeploy runs
  // after the new task reaches running (cache warmup, smoke checks).
  preDeploy: z.array(z.string()).nullable().optional(),
  postDeploy: z.array(z.string()).nullable().optional(),
  // Public domains to attach when the service is first created by Apply.
  // A create-time seed so an operator can set a domain *before* deploy.
  // The reconciler creates the proxy routes (and exposes the service) on
  // create; thereafter domains are managed via the resource's domains UI,
  // so this field is intentionally not diffed for drift. Requires the
  // service to declare an http port.
  domains: z
    .array(
      z.object({
        domain: z.string().min(1),
        primary: z.boolean().optional(),
      }),
    )
    .optional(),
  /**
   * Which machine this runs on, by server NAME.
   *
   * A name, not an id, for the same reason a hostable database's `host` names
   * another resource by name: a manifest is checked into a repo and applied to
   * a different install, where the id of "the box in Frankfurt" is different
   * and its name is not. An unknown name is refused at apply rather than
   * silently degrading to "anywhere" — placement that quietly does nothing is
   * how a volume ends up on the wrong disk.
   *
   * Create-time only, and deliberately not diffed for drift: MOVING a live
   * resource has to roll it (and, if it has a volume, abandon that volume),
   * which an apply must never do implicitly. `service.setPlacement` is the one
   * surface that moves something, exactly as `domains` above is a create-time
   * seed with its own UI afterwards.
   */
  server: z.string().min(1).optional(),
});

const imageServiceSchema = serviceCommonSchema.extend({
  source: z.literal("image"),
  image: z.string().min(1),
});

const gitServiceSchema = serviceCommonSchema.extend({
  source: z.literal("git"),
  // Portable repo reference: "owner/repo". Resolved to the internal git_repo
  // row by fullName within the org's installations on apply, so no opaque id
  // lands on disk (mirrors compose's portable `gitRepoUrl`). A public repo
  // connected by URL also has a fullName and resolves the same way. Optional:
  // a git service may stage unbound and only its build fails, clearly, until
  // bound. Each git service owns its own repo. Two services in one project can
  // build from two different repos.
  repo: z
    .string()
    .min(1)
    .refine((v) => v.split("/").length === 2 && v.split("/").every(Boolean), {
      message: 'repo must be "owner/name"',
    })
    .optional(),
  // Branch whose pushes deploy this service. Optional. Falls back to the
  // repo's default branch at resolve time.
  branch: z.string().min(1).nullable().optional(),
  sourceSubdir: z.string().nullable().optional(),
  build: buildSchema.optional(),
  // Per-service image target: fully-qualified image repository, no tag (the
  // builder appends <sha> + :latest). Optional → registry-less local build
  // (image stays in the host daemon). The push credential is matched from the
  // shared registry library by this string's host at build time.
  imageRepository: z.string().min(1).nullable().optional(),
  // Per-service PR-preview opt-in: a pull_request on this service's repo
  // rebuilds it into the PR's preview environment. Declared-only (same
  // convention as publicEnabled on databases): omitted → the toggle is
  // live-managed and Apply leaves it alone, so pre-existing manifests can't
  // phantom-revert a live toggle.
  previews: z.boolean().optional(),
});

// Source the build from a tarball uploaded at deploy time (`otterdeploy deploy`
// tars the local project and streams it to the control plane), then build it on
// the server with the same railpack/Dockerfile pipeline as a git service, no
// GitHub binding. The manifest only marks the service as upload-sourced; the
// bytes are supplied per-deploy, not declared here (an upload service with no
// tarball yet simply has no build until one is pushed). Reuses the git service's
// build/subdir/imageRepository fields verbatim.
const uploadServiceSchema = serviceCommonSchema.extend({
  source: z.literal("upload"),
  sourceSubdir: z.string().nullable().optional(),
  build: buildSchema.optional(),
  imageRepository: z.string().min(1).nullable().optional(),
});

export const serviceSchema = z.discriminatedUnion("source", [
  imageServiceSchema,
  gitServiceSchema,
  uploadServiceSchema,
]);
export type ServiceManifest = z.infer<typeof serviceSchema>;

// ── Databases ───────────────────────────────────────────────────────────
//
// Engine is the discriminator inside each database block. Each engine has
// its own valid fields; unknown engine-specific keys are rejected.

const databaseCommonSchema = z.object({
  resources: resourcesSchema.optional(),
  publicEnabled: z.boolean().optional(),
  // Opt this database into PR-preview branching (an isolated per-PR copy).
  // Declared-only: omitted leaves the live toggle alone. Default off. An
  // unbranched database is shared with the base by preview services.
  previews: z.boolean().optional(),
  // Extra container env injected alongside the derived POSTGRES_* / etc.
  // Same ref grammar as service env.
  extraEnv: envMap.optional(),
});

/**
 * Fields only a database that can SHARE a server carries.
 *
 * `host` names another database resource by name — the same way `${{name.VAR}}`
 * refs address one — rather than by id, because a manifest has to survive being
 * checked into a repo and applied to a different install. Declaring it means
 * "this is a logical database inside that server", so no container, no volume
 * and no placement of its own.
 *
 * Create-time only. Moving a live database between servers means copying its
 * data, which a manifest apply must never do implicitly, so a changed `host` is
 * refused rather than silently re-homed.
 */
const hostableSchema = z.object({
  host: z.string().min(1).optional(),
  connectionLimit: z.number().int().positive().max(10_000).optional(),
});

const postgresSchema = databaseCommonSchema.extend(hostableSchema.shape).extend({
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

const mariadbSchema = databaseCommonSchema.extend(hostableSchema.shape).extend({
  engine: z.literal("mariadb"),
  version: z.string().min(1).optional(),
});

const mongodbSchema = databaseCommonSchema.extend(hostableSchema.shape).extend({
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

// ── Compose stacks ──────────────────────────────────────────────────────
//
// A compose stack is a Docker Compose file deployed as one unit (N swarm
// services on the project overlay net). `source` is the discriminator:
// `inline` carries the raw YAML; `git` points at a public repo whose
// compose file the builder resolves. `env` seeds the project variables the
// file's `${VAR}` refs resolve against. A create-time seed (like service
// `domains`), intentionally not diffed for drift. `exposed` maps a
// `service:port` to a public domain. See docs/designs/compose.md.

// Compose `${VAR}` names are author-chosen and NOT restricted to UPPER_SNAKE
// the way service env keys are (a compose file may use `${db_password}`), so
// this map is deliberately looser than the service/database `envMap`.
const composeEnvMap = z.record(z.string().min(1), z.string());

/**
 * Per-CHILD env for a stack, keyed by the file's own compose service key
 * (`db`, not the renamed `autumn-db`): the key is the one thing that survives
 * `pickResourceName` and `pickInternalHostname`.
 *
 * Distinct from `env` above, which seeds the PROJECT variables the file's
 * `${VAR}` refs read. This is a child's own container env, which until now
 * lived only in DB rows — invisible to `otd export`, to DR restore and to the
 * diff, so a stack rebuilt from its manifest came back without it (od-uhot).
 *
 * A create-time seed, like the compose file's own env: env is the operator's
 * once a child exists, and a later manifest apply must not clobber a value
 * they tuned.
 */
const composeServicesMap = z.record(z.string().min(1), z.object({ env: composeEnvMap.optional() }));

const composeExposedSchema = z.object({
  service: z.string().min(1),
  port: z.number().int().positive(),
  domain: z.string().optional(),
});

const composeInlineSchema = z.object({
  source: z.literal("inline"),
  // The designated compose file's content (single-file stacks set only this).
  content: z.string().min(1),
  // Multi-file stack: compose file + supporting files (Dockerfiles/build
  // contexts, env_file targets, bind-mounted scripts). `composePath` names the
  // compose entry; `content` mirrors it.
  //
  // `interpolate` has to be declared HERE, not just on the compose contract:
  // the wizard stages into the manifest first, so an undeclared key is
  // stripped by this parse and the flag never reaches the deploy. The file
  // then materializes with its `${VAR}` refs intact and the container starts
  // against literal `${…}` text — which is exactly how the NetBird template
  // shipped broken (crash loop on `parse "rels://${NETBIRD_DOMAIN}"`).
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
        interpolate: z.boolean().optional(),
      }),
    )
    .optional(),
  composePath: z.string().nullable().optional(),
  env: composeEnvMap.optional(),
  // Per-child container env; see composeServicesMap.
  services: composeServicesMap.optional(),
  exposed: z.array(composeExposedSchema).optional(),
  // Brand mark for the graph node (SvglLogo search string), set when the stack
  // is deployed from a template. Presentation-only.
  logoBrand: z.string().max(64).optional(),
  /** Machine every service in this stack runs on, by server NAME. Same
   *  create-time-seed rules as a service's `server`; see serviceCommonSchema. */
  server: z.string().min(1).optional(),
});

const composeGitSchema = z.object({
  source: z.literal("git"),
  // Bind by repo id (private-capable, from the repo picker) OR a raw public URL
  // (legacy paste). At least one must be present; gitRepoId wins when both are.
  gitRepoId: z.string().nullable().optional(),
  gitRepoUrl: z.string().nullable().optional(),
  gitRef: z.string().nullable().optional(),
  composePath: z.string().nullable().optional(),
  // Root directory within the repo the stack builds from.
  sourceSubdir: z.string().nullable().optional(),
  env: composeEnvMap.optional(),
  // Per-child container env; see composeServicesMap.
  services: composeServicesMap.optional(),
  exposed: z.array(composeExposedSchema).optional(),
  // Brand mark for the graph node (SvglLogo search string), set when the stack
  // is deployed from a template. Presentation-only.
  logoBrand: z.string().max(64).optional(),
  /** Machine every service in this stack runs on, by server NAME. Same
   *  create-time-seed rules as a service's `server`; see serviceCommonSchema. */
  server: z.string().min(1).optional(),
});

export const composeSchema = z.discriminatedUnion("source", [
  composeInlineSchema,
  composeGitSchema,
]);
export type ComposeManifest = z.infer<typeof composeSchema>;

// ── Named resource maps ────────────────────────────────────────────────
//
// Identity is the map key (the user-chosen name). Resource names share the
// `resource.name` slug shape: lowercase letters, digits, dashes; starts
// with a letter; <= 63 chars (matches docker service name limits).

const resourceName = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, {
  message: "resource name must be lowercase letters, digits, and dashes; 1–63 chars",
});

const servicesMap = z.record(resourceName, serviceSchema);
const databasesMap = z.record(resourceName, databaseSchema);
const composesMap = z.record(resourceName, composeSchema);

// ── Environment overrides ──────────────────────────────────────────────
//
// An environment block can redeclare any service/database with the same
// discriminator. The CLI deep-merges these onto the base before sending.
// Validation is intentionally permissive here. The *merged* result is
// what the server validates strictly. This block validates only that
// keys/types are well-formed, not that they're complete.

const partialServiceSchema = z.union([
  imageServiceSchema.partial(),
  gitServiceSchema.partial(),
  uploadServiceSchema.partial(),
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
  // Compose stacks. Optional + defaulted so manifests written before compose
  // joined the manifest still parse. Environment overrides intentionally don't
  // apply to compose (no `composes` on environmentBlockSchema). A stack is an
  // atomic unit, not a per-env-tunable resource, in v1.
  composes: composesMap.default({}),
  environments: z.record(z.string().min(1), environmentBlockSchema).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
