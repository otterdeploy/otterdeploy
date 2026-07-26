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

export interface ParsedComposeService {
  name: string;
  /** Image ref, or `null` when the service builds from source. */
  image: string | null;
  build: ParsedBuild | null;
  command: string[] | null;
  entrypoint: string[] | null;
  env: Record<string, string>;
  /** `env_file` paths (relative to the stack tree); read + merged into `env`
   *  at deploy time from the materialized files. */
  envFile: string[];
  ports: ParsedPort[];
  volumes: ParsedMount[];
  networks: string[];
  healthcheck: ParsedHealthcheck | null;
  replicas: number;
  resources: ParsedResources;
  restart: ParsedRestart;
  dependsOn: string[];

  // od-5j8.24 — fields the platform previously read off the raw service
  // object and then threw away with no warning. Captured (never silently
  // dropped) so `stack/compose/compatibility.ts` can classify each one as a
  // hard failure or a surfaced warning instead of quietly diverging from
  // what the compose file asked for. None of these are applied to the
  // deployed ContainerSpec by anything in `to-spec.ts` / `reconcile-map.ts`
  // today — od-5j8.23's policy is the sole authority on what a tenant
  // workload's container is allowed to run with.
  /** `privileged: true` — Docker Swarm services cannot run privileged at
   *  all (no such field exists in Swarm's ContainerSpec), so this is always
   *  a hard compatibility failure, never silently ignored. */
  privileged: boolean;
  /** `cap_add` — always a hard failure today: granting a tenant-requested
   *  Linux capability beyond the platform's baseline has no admin-review
   *  path yet (see `swarm/container-security.ts`). */
  capAdd: string[];
  /** `cap_drop` — always safe (dropping capabilities is strictly tightening
   *  the sandbox); surfaced as an informational warning since it's already
   *  implied by the platform's drop-all baseline. */
  capDrop: string[];
  /** `devices` — Docker Swarm services have no host-device passthrough at
   *  all; always a hard failure. */
  devices: string[];
  /** `security_opt` — classified entry-by-entry: an escalating value
   *  (`seccomp:unconfined`, `apparmor:unconfined`, `no-new-privileges:false`,
   *  `label:disable`, …) is a hard failure, anything else a warning. */
  securityOpt: string[];
  /** `network_mode` — Swarm services always attach to the project overlay
   *  network; any explicit override (`host`, `none`, `container:x`,
   *  `service:x`, …) can't be honored and is a hard failure. */
  networkMode: string | null;
  /** `pid` — `host` (or `container:x`/`service:x`) shares a foreign PID
   *  namespace and is a hard failure; any other value is a warning. */
  pid: string | null;
  /** `sysctls` — not applied yet; warning. */
  sysctls: Record<string, string>;
  /** `ulimits` present — not applied yet; warning. */
  hasUlimits: boolean;
  /** Per-service `secrets:`/`configs:` references (names only) — not
   *  supported yet, same as the existing top-level `secrets`/`configs`
   *  warning; warning. */
  secrets: string[];
  configs: string[];
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
