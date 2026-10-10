/**
 * Normalized representation of a user-supplied Docker Compose file.
 *
 * Real compose is permissive (ports as "3000:3000" strings OR numbers OR
 * long-form objects, environment as map OR `KEY=val` array, volumes as short
 * strings OR long-form, etc.). `parseCompose` collapses all of that into this
 * one normal shape, which maps near-1:1 onto `SwarmServiceSpec` for deploy and
 * onto `ComposeServiceSummary` for the UI. See docs/designs/compose.md.
 */

export interface ParsedPort {
  /** Container port the service listens on. */
  target: number;
  /** Host/ingress published port, when the compose file pins one. */
  published?: number;
  protocol: "tcp" | "udp";
}

export interface ParsedMount {
  type: "volume" | "bind" | "tmpfs";
  /** Named volume (type=volume) or host path (type=bind). */
  source?: string;
  target: string;
  readOnly: boolean;
}

export interface ParsedBuild {
  /** Build context dir, relative to the compose file. */
  context: string;
  dockerfile?: string;
  args?: Record<string, string>;
}

export interface ParsedHealthcheck {
  /** Normalized to CMD-SHELL form: ["CMD-SHELL", "<cmd>"] or ["CMD", ...]. */
  test: string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  startPeriod?: string;
  disable?: boolean;
}

export interface ParsedResources {
  /** Fractional CPUs as a string, e.g. "0.5" (compose `cpus`). */
  cpus?: string;
  /** Memory limit in MB (compose `memory` like "512M"/"1g" → MB). */
  memoryMb?: number;
}

export type ParsedRestart = "no" | "always" | "on-failure" | "unless-stopped";

/** One `env_file` entry. Compose refuses to start a service whose REQUIRED
 *  env_file is missing; `required: false` (long form) lets it skip. */
export interface ParsedEnvFile {
  path: string;
  required: boolean;
}

export interface ParsedComposeService {
  name: string;
  /** Image ref, or `null` when the service builds from source. */
  image: string | null;
  build: ParsedBuild | null;
  command: string[] | null;
  entrypoint: string[] | null;
  /** `environment` entries that carry a value (`KEY=value`, `KEY: value`). */
  env: Record<string, string>;
  /**
   * `environment` entries with no value (`- KEY`, `KEY:`): compose passes the
   * same-named variable through, and leaves the key unset when there is none.
   * Never an empty string.
   */
  passthroughEnv: string[];
  /** `env_file` targets, relative to the compose file; read + merged under
   *  `env` at deploy time (see routers/compose/env-files.ts). */
  envFile: ParsedEnvFile[];
  ports: ParsedPort[];
  volumes: ParsedMount[];
  networks: string[];
  healthcheck: ParsedHealthcheck | null;
  replicas: number;
  resources: ParsedResources;
  restart: ParsedRestart;
  /**
   * Compose `stop_grace_period` as written ("1m30s"): how long the runtime
   * waits after the stop signal before killing the container. Null when the
   * file does not say. A database child that is killed mid-checkpoint panics on
   * its next start, so the file's own value is honoured.
   */
  stopGracePeriod: string | null;
  /** Compose `stop_signal` (`SIGINT`, `SIGQUIT`, ...), or null for the image's own. */
  stopSignal: string | null;
  dependsOn: string[];
  /**
   * Compose `labels`, normalized to a flat map (compose allows both the map
   * and the `KEY=value` list form).
   *
   * Surfaced because the platform reads a few `otterdeploy.*` keys off it —
   * facts about a service that compose has no field for. Today that is
   * `otterdeploy.upstream.protocol`, which tells the edge to dial this
   * service over h2c because it speaks gRPC. Everything else is carried
   * through untouched and ignored; a stack's own labels (Traefik's, say) are
   * none of our business.
   */
  labels: Record<string, string>;
}

export interface ParsedCompose {
  /** Compose's optional top-level `name:` (the project name), or null. */
  name: string | null;
  services: ParsedComposeService[];
  /** Named volumes declared at the top level. */
  volumeNames: string[];
  /** Named networks declared at the top level. */
  networkNames: string[];
  /** Unsupported / ignored constructs, surfaced to the user (not fatal). */
  warnings: string[];
}
