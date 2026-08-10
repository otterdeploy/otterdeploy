/**
 * Compose-stack shared types. A `type: compose` resource deploys a Docker
 * Compose file as one swarm stack (N services). The YAML file is the source of
 * truth; these are the derived, UI-facing summaries persisted alongside it.
 *
 * Single source of truth — imported by:
 *   - the DB column types ($type<>() on compose_resource.{services,exposed})
 *   - the api parse/normalize module + router contracts
 *   - the web wizard preview
 *
 * Keep this file zod-free so it can be consumed from layers that don't (and
 * shouldn't) depend on `@otterdeploy/api`. See docs/designs/compose.md.
 */

/** Derived per-service summary, recomputed from the compose file on each save.
 *  Type alias, not interface — aliases keep the implicit index signature that
 *  lets these summaries assign into `JsonObject`-typed jsonb columns. */
// oxlint-disable-next-line typescript/consistent-type-definitions
export type ComposeServiceSummary = {
  /** Service key in the compose file. */
  name: string;
  /** Resolved image ref; `null` when the service builds from source. */
  image: string | null;
  /** True when the service has a `build:` context (needs a build step). */
  hasBuild: boolean;
  /** Declared container ports (target ports), for the UI preview. */
  ports: number[];
  /** Named-volume sources the service mounts — rendered as chips on the graph
   *  card so a stateful service reads as stateful at a glance. Empty when the
   *  service mounts nothing (or only binds/tmpfs, which we drop). */
  volumes: string[];
};

/** A `service:port` fronted by a public domain. */
// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
export type ComposeExposed = {
  service: string;
  port: number;
  domain: string;
};

/**
 * One file in a multi-file INLINE stack: the compose file itself plus any
 * supporting files the stack references (`build:` Dockerfiles + contexts,
 * `env_file` targets, bind-mounted scripts/configs). `path` is repo-relative
 * with `/` separators (nested paths create folders); one entry is the compose
 * file (its path also lands in `compose_resource.compose_path`). Materialized
 * to disk at deploy/build so the compose compiler + build worker can resolve
 * those relative references. See docs/designs/compose.md.
 */
// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
export type ComposeFile = {
  path: string;
  content: string;
};

/**
 * The filenames `docker compose` itself looks for, in its precedence order.
 *
 * This list lived in three places at once — the builder's clone probe, the api
 * handler's inline-tree picker, and (implicitly) the wizard's "auto-detect"
 * placeholder, which promised a detection it never performed. Three copies of
 * a convention is three chances to disagree about what counts as a compose
 * file, and the wizard's copy being *empty* is exactly how a repo with a
 * perfectly valid `docker-compose.yml` reached the build step with nothing
 * detected. One list, imported everywhere.
 */
export const COMPOSE_FILENAMES = [
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
] as const;

/**
 * Pick the compose file out of a flat directory listing, honouring the
 * precedence above. `names` is any set of filenames in a single directory
 * (a git tree listing, a readdir); returns null when none qualifies.
 */
export function detectComposeFilename(names: Iterable<string>): string | null {
  const present = new Set(names);
  return COMPOSE_FILENAMES.find((name) => present.has(name)) ?? null;
}

/** Every compose-looking filename in a listing, in precedence order. Used by
 *  the wizard to disambiguate when a repo ships more than one. */
export function detectComposeFilenames(names: Iterable<string>): string[] {
  const present = new Set(names);
  return COMPOSE_FILENAMES.filter((name) => present.has(name));
}
