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

/** The TCP/UDP port space. A port outside it is not a configuration choice
 *  the operator can make work: docker rejects it at deploy, long after the
 *  manifest validated. Caught here so the error names the field. */
const PORT_MAX = 65_535;

const portSchema = z.object({
  container: z.number().int().positive().max(PORT_MAX),
  protocol: z.enum(["tcp", "udp"]).optional(),
  appProtocol: z.enum(["http", "tcp"]).optional(),
  primary: z.boolean().optional(),
  // Optional name; needed for `${service:foo.port.<name>}` references.
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
});

/**
 * Exec form, or a shell line we wrap into it.
 *
 * `["sh", "-c", "a && b"]` is what actually runs; a bare `"a && b"` is the
 * same thing said shorter. The transform happens at PARSE, so everything
 * downstream (diff, apply, the runtime spec) only ever sees exec form and no
 * consumer has to know the shorthand exists.
 *
 * DELIBERATELY NOT offered for `startCommand` or `entrypoint`, even though
 * compose allows a string for both. Those name the container's long-running
 * process, and wrapping one in `sh -c` makes the SHELL pid 1: it does not
 * forward SIGTERM, so the app never gets its shutdown signal and dies on the
 * stop timeout instead. That is a silent, delayed failure attached to a
 * convenience, and it is not worth it. Hooks run in throwaway containers to
 * completion, so the same wrapper is harmless there.
 */
const shellOrExecForm = z.union([
  z.array(z.string()),
  z.string().transform((line) => ["sh", "-c", line]),
]);

/** An hour. Any healthcheck or restart timing beyond this is a unit mistake
 *  (seconds typed as milliseconds, or the reverse). */
const MAX_DURATION_MS = 3_600_000;

const healthcheckSchema = z.object({
  // A healthcheck with no command cannot check anything; docker would treat the
  // empty list as "inherit from the image", which is not what declaring an
  // empty `cmd` says.
  cmd: z.array(z.string()).min(1),
  intervalMs: z.number().int().positive().max(MAX_DURATION_MS).optional(),
  timeoutMs: z.number().int().positive().max(MAX_DURATION_MS).optional(),
  retries: z.number().int().nonnegative().max(100).optional(),
  startMs: z.number().int().nonnegative().max(MAX_DURATION_MS).optional(),
});

/**
 * Ceilings for the resource knobs.
 *
 * Every one of these was `positive()` with no upper bound, so `memoryMb: 1e15`
 * or `replicas: 1e9` parsed cleanly and failed later against docker — or worse,
 * was accepted by docker and scheduled something that could never fit. A cap is
 * not a policy decision about what a host can afford; it is the line past which
 * the value is certainly a typo (a `memoryMb` entered as bytes, a `cpuLimit`
 * entered as millicores). Generous on purpose.
 */
const MAX_CPUS = 1024;
/** 4 TiB expressed in MB: past any single-container allocation, and the value
 *  a byte-vs-megabyte mix-up lands on. */
const MAX_MEMORY_MB = 4_194_304;
/** Linux `pid_max` ceiling on 64-bit. */
const MAX_PIDS = 4_194_304;

const resourcesSchema = z
  .object({
    // `nonnegative`, not `positive`: 0 is docker's "no limit".
    cpuLimit: z.number().nonnegative().max(MAX_CPUS).optional(),
    memoryMb: z.number().int().positive().max(MAX_MEMORY_MB).optional(),
    cpuReservation: z.number().nonnegative().max(MAX_CPUS).optional(),
    memoryReservationMb: z.number().int().positive().max(MAX_MEMORY_MB).optional(),
    diskMb: z.number().int().positive().max(MAX_MEMORY_MB).optional(),
    swapMb: z.number().int().positive().max(MAX_MEMORY_MB).optional(),
    pidsLimit: z.number().int().positive().max(MAX_PIDS).optional(),
  })
  .superRefine((resources, ctx) => {
    // Docker refuses both of these at deploy ("Minimum memory limit can not be
    // less than memory reservation limit"), so accepting them here only moves
    // the error somewhere that cannot name the field.
    const { cpuLimit, cpuReservation, memoryMb, memoryReservationMb } = resources;
    if (cpuLimit !== undefined && cpuReservation !== undefined && cpuReservation > cpuLimit) {
      ctx.addIssue({
        code: "custom",
        path: ["cpuReservation"],
        message: `cpuReservation (${cpuReservation}) cannot exceed cpuLimit (${cpuLimit}).`,
      });
    }
    if (
      memoryMb !== undefined &&
      memoryReservationMb !== undefined &&
      memoryReservationMb > memoryMb
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["memoryReservationMb"],
        message: `memoryReservationMb (${memoryReservationMb}) cannot exceed memoryMb (${memoryMb}).`,
      });
    }
  });

const restartSchema = z.object({
  condition: z.enum(["none", "on-failure", "any"]),
  maxAttempts: z.number().int().nonnegative().max(1_000_000).nullable().optional(),
  delayMs: z.number().int().nonnegative().max(MAX_DURATION_MS).optional(),
  // Window (ms) over which `maxAttempts` is counted when condition is
  // `on-failure`. Matches docker swarm's restart_policy.window. Outside
  // the window, the failure counter resets to zero.
  windowMs: z.number().int().nonnegative().max(MAX_DURATION_MS).optional(),
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
  // `nonnegative`: 0 is a deliberate scale-to-zero. Capped because a swarm
  // service with a million replicas is a typo, not a plan.
  replicas: z.number().int().nonnegative().max(10_000).optional(),
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
  //
  // A plain string is accepted as shorthand for `["sh", "-c", <string>]`,
  // because the thing people write here is a shell line
  // ("bun run db:migrate && bun run db:seed") and rejecting it taught
  // nothing: the error said `expected array, received string` with no hint
  // that exec form was wanted (od-3kvm).
  preDeploy: shellOrExecForm.nullable().optional(),
  postDeploy: shellOrExecForm.nullable().optional(),
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
  // Same TCP/UDP range as a service's `ports[].container`: this is the port a
  // public route is pointed at, so an out-of-range value is a broken route.
  port: z.number().int().positive().max(PORT_MAX),
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

// `null` removes the resource from this environment entirely, which is the
// only way to say "this one does not exist here". merge.ts has implemented and
// documented that since it was written ("`null` value → deletes the key from
// the base"), but the value was typed as an object, so every null was rejected
// at the parse boundary and the branch could never be reached.
//
// Without it a project whose environments genuinely hold different resources
// has no way to say so: the base map is the set every environment is expected
// to have, so anything living in only one of them is reported by every OTHER
// environment's diff as a pending create. That change can be neither applied
// (it would duplicate the resource into the wrong environment) nor discarded
// (the declaration is legitimately in the applied snapshot), so the
// pending-changes bar never clears. See __tests__/environment-scoping.test.ts.
const environmentBlockSchema = z.object({
  services: z.record(resourceName, partialServiceSchema.nullable()).optional(),
  databases: z.record(resourceName, partialDatabaseSchema.nullable()).optional(),
});
export type EnvironmentOverride = z.infer<typeof environmentBlockSchema>;

// ── Top-level manifest ─────────────────────────────────────────────────

/**
 * Names are unique across services, databases AND compose stacks, not merely
 * within each map.
 *
 * All three become rows in one `resource` table, under one unique index on
 * (project, environment, name). Three separate maps in the JSON hides that:
 * declaring `services.api` and `databases.api` reads as two different things
 * and parses fine, but apply runs databases in phase 1 and services later, so
 * the database is created and the service then dies on a raw unique-constraint
 * violation — leaving the project half-applied, with an error that names a
 * postgres index rather than the duplicate name that caused it. Apply is not
 * transactional across phases, so there is no rollback.
 *
 * Checked per environment as well as on the base, because an environment block
 * can introduce a name (and `null` can remove one), so an environment's
 * effective set is not the base set.
 */
function collectCollisions(
  buckets: ReadonlyArray<readonly [kind: string, names: Iterable<string>]>,
): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const [kind, names] of buckets) {
    for (const name of names) {
      const kinds = seen.get(name);
      if (kinds) kinds.push(kind);
      else seen.set(name, [kind]);
    }
  }
  return new Map([...seen].filter(([, kinds]) => kinds.length > 1));
}

/** The names an environment actually has: the base map, plus the block's own
 *  declarations, minus the ones it set to `null` to opt out of. (A `null`
 *  value is the documented "this resource does not exist here"; `unknown`
 *  already covers it, so the signature cannot spell it out.) */
function namesForEnvironment(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>> | undefined,
): string[] {
  const names = new Set(Object.keys(base));
  for (const [name, value] of Object.entries(override ?? {})) {
    if (value === null) names.delete(name);
    else names.add(name);
  }
  return [...names];
}

const manifestObjectSchema = z.object({
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

export const manifestSchema = manifestObjectSchema.superRefine((manifest, ctx) => {
  const report = (collisions: Map<string, string[]>, where: readonly (string | number)[]) => {
    for (const [name, kinds] of collisions) {
      ctx.addIssue({
        code: "custom",
        path: [...where],
        message: `"${name}" is declared as ${kinds.join(" and ")}. Resource names share one namespace, so each must be unique across services, databases and composes.`,
      });
    }
  };

  report(
    collectCollisions([
      ["a service", Object.keys(manifest.services)],
      ["a database", Object.keys(manifest.databases)],
      ["a compose stack", Object.keys(manifest.composes)],
    ]),
    [],
  );

  for (const [envName, block] of Object.entries(manifest.environments ?? {})) {
    report(
      collectCollisions([
        ["a service", namesForEnvironment(manifest.services, block.services)],
        ["a database", namesForEnvironment(manifest.databases, block.databases)],
        // Compose stacks are not environment-overridable (no `composes` on
        // environmentBlockSchema), so every environment inherits the base set.
        ["a compose stack", Object.keys(manifest.composes)],
      ]),
      ["environments", envName],
    );
  }

  // Port rules are per service. Each becomes a `service_port` row and feeds the
  // runtime spec, so a duplicate or a second primary is not a harmless
  // redundancy: it makes which row wins depend on insertion order.
  for (const [serviceName, service] of Object.entries(manifest.services)) {
    const ports = service.ports ?? [];
    const at = (index: number, field: string) => ["services", serviceName, "ports", index, field];

    const primaries = ports.flatMap((port, index) => (port.primary === true ? [index] : []));
    if (primaries.length > 1) {
      for (const index of primaries.slice(1)) {
        ctx.addIssue({
          code: "custom",
          path: at(index, "primary"),
          // The primary port is the one the public route points at. Two
          // candidates means the route target depends on array order.
          message: `service "${serviceName}" marks ${primaries.length} ports primary; exactly one port can be primary.`,
        });
      }
    }

    const seenContainer = new Map<number, number>();
    const seenName = new Map<string, number>();
    for (const [index, port] of ports.entries()) {
      const firstContainer = seenContainer.get(port.container);
      if (firstContainer === undefined) seenContainer.set(port.container, index);
      else {
        ctx.addIssue({
          code: "custom",
          path: at(index, "container"),
          message: `service "${serviceName}" declares container port ${port.container} twice (also at index ${firstContainer}).`,
        });
      }
      if (port.name === undefined) continue;
      const firstName = seenName.get(port.name);
      if (firstName === undefined) seenName.set(port.name, index);
      else {
        ctx.addIssue({
          code: "custom",
          path: at(index, "name"),
          // Port names are how `${service:foo.port.<name>}` selects a port, so
          // a duplicate makes that reference ambiguous.
          message: `service "${serviceName}" declares two ports named "${port.name}" (also at index ${firstName}).`,
        });
      }
    }
  }
});

export type Manifest = z.infer<typeof manifestSchema>;
