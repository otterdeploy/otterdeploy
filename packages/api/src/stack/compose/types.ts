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
  ports: ParsedPort[];
  volumes: ParsedMount[];
  networks: string[];
  healthcheck: ParsedHealthcheck | null;
  replicas: number;
  resources: ParsedResources;
  restart: ParsedRestart;
  dependsOn: string[];
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
