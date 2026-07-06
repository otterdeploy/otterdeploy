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

/** Derived per-service summary, recomputed from the compose file on each save. */
export interface ComposeServiceSummary {
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
}

/** A `service:port` fronted by a public domain. */
export interface ComposeExposed {
  service: string;
  port: number;
  domain: string;
}

/**
 * One file in a multi-file INLINE stack: the compose file itself plus any
 * supporting files the stack references (`build:` Dockerfiles + contexts,
 * `env_file` targets, bind-mounted scripts/configs). `path` is repo-relative
 * with `/` separators (nested paths create folders); one entry is the compose
 * file (its path also lands in `compose_resource.compose_path`). Materialized
 * to disk at deploy/build so the compose compiler + build worker can resolve
 * those relative references. See docs/designs/compose.md.
 */
export interface ComposeFile {
  path: string;
  content: string;
}
