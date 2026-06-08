/**
 * Pure mappers: wizard form state → manifest service/database specs.
 *
 * The wizard collects far more than the old create path persisted — env
 * vars, resource sizing, replicas, the chosen builder — and silently
 * dropped all of it, so a freshly-created resource ignored everything the
 * operator configured. These helpers fold that state into the manifest
 * spec the reconciler actually reads, so "what you filled in" == "what
 * gets deployed". Kept side-effect free + framework-free so they're unit
 * testable and don't bloat the wizard past its file-length cap.
 */

import type { Manifest } from "@otterdeploy/api/manifest";
import type { BuildConfig } from "@otterdeploy/shared/build-config";

import { RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";

import type { Port } from "./form-fields/ports-field";
import type { Var } from "./form-fields/variables-field";

type ServiceSpec = Manifest["services"][string];
type DatabaseSpec = Manifest["databases"][string];

interface ManifestPort {
  container: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  primary?: boolean;
}

interface ManifestResources {
  cpuLimit: number;
  memoryMb: number;
}

// Manifest env keys must be UPPER_SNAKE (matches the zod `envMap` rule).
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
// App-protocol grouping: anything HTTP-shaped advertises as `http` so the
// proxy/route layer can terminate it; everything else is raw `tcp`.
const HTTP_PROTOCOLS = new Set(["http", "http2", "grpc"]);

/**
 * Wizard variable rows → manifest env map. A row flagged secret with no
 * typed value becomes the `${secret}` sentinel (value supplied later via
 * `otterdeploy env set`); a secret row WITH a value stores the value
 * (the operator typed it, so honor it — the manifest is plaintext at rest).
 * Keys that don't satisfy the UPPER_SNAKE rule are dropped rather than
 * failing the whole create.
 */
export function envFromVars(vars: Var[]): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const v of vars) {
    const key = v.key.trim();
    if (!ENV_KEY_RE.test(key)) continue;
    env[key] = v.secret && v.value.trim() === "" ? "${secret}" : v.value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

/** Resource preset (or custom sliders) → manifest cpu/memory limits. */
export function resourcesFromForm(
  presetId: string,
  customCpu: number,
  customMem: number,
): ManifestResources | undefined {
  if (presetId === "custom") {
    return { cpuLimit: customCpu, memoryMb: customMem };
  }
  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  if (!preset || preset.cpu == null || preset.mem == null) return undefined;
  return { cpuLimit: preset.cpu, memoryMb: preset.mem };
}

/** Wizard port rows → manifest ports. First row is primary. */
export function portsToManifest(ports: Port[]): ManifestPort[] {
  return ports
    .filter((p) => p.port > 0)
    .map((p, i) => ({
      container: p.port,
      protocol: p.protocol === "udp" ? "udp" : "tcp",
      appProtocol: HTTP_PROTOCOLS.has(p.protocol) ? "http" : "tcp",
      primary: i === 0,
    }));
}

/** Builder picker id → manifest BuildConfig. Builders without a manifest
 *  variant (buildpack, static) fall back to auto-detect. */
export function buildFromBuilderId(builderId: string): BuildConfig {
  switch (builderId) {
    case "dockerfile":
      return { builder: "dockerfile" };
    case "railpack":
      return { builder: "railpack" };
    case "compose":
      return { builder: "compose" };
    default:
      return { builder: "auto" };
  }
}

export interface ServiceSpecInput {
  source: "image" | "git";
  /** Wizard kind id (app/worker/static/docker/…). Static forces the
   *  railpack builder so the build produces a Caddy static image. */
  kindId: string;
  image: string;
  ports: Port[];
  variables: Var[];
  replicas: number;
  presetId: string;
  customCpu: number;
  customMem: number;
  builderId: string;
  /** Static-kind only: serve index.html for unmatched routes (SPA). */
  spa: boolean;
  /** Repo-relative root directory for git sources ("" = repo root). */
  root: string;
}

/** Assemble the full manifest service spec from wizard state. */
export function buildServiceSpec(input: ServiceSpecInput): ServiceSpec {
  const env = envFromVars(input.variables);
  const resources = resourcesFromForm(input.presetId, input.customCpu, input.customMem);
  const common = {
    ports: portsToManifest(input.ports),
    ...(env ? { env } : {}),
    ...(input.replicas > 1 ? { replicas: input.replicas } : {}),
    ...(resources ? { resources } : {}),
  };
  if (input.source === "image") {
    return { source: "image", image: input.image, ...common };
  }
  // Static sites always build with railpack (which emits a Caddy image to
  // serve the assets); the SPA toggle becomes an index.html fallback.
  // Every other compute kind honors the picked builder.
  const build: BuildConfig =
    input.kindId === "static"
      ? { builder: "railpack", ...(input.spa ? { spa: true } : {}) }
      : buildFromBuilderId(input.builderId);
  return {
    source: "git",
    ...(input.root ? { sourceSubdir: input.root } : {}),
    build,
    ...common,
  };
}

export interface DatabaseSpecInput {
  engine: "postgres" | "redis" | "mariadb" | "mongodb";
  publicEnabled: boolean;
  extensions: string[];
  version: string | null;
  presetId: string;
  customCpu: number;
  customMem: number;
}

/** Assemble the full manifest database spec from wizard state. */
export function buildDatabaseSpec(input: DatabaseSpecInput): DatabaseSpec {
  const resources = resourcesFromForm(input.presetId, input.customCpu, input.customMem);
  const base = {
    ...(input.publicEnabled ? { publicEnabled: true } : {}),
    ...(resources ? { resources } : {}),
    ...(input.version ? { version: input.version } : {}),
  };
  if (input.engine === "postgres") {
    return {
      engine: "postgres",
      ...base,
      ...(input.extensions.length > 0 ? { extensions: input.extensions } : {}),
    } as DatabaseSpec;
  }
  return { engine: input.engine, ...base } as DatabaseSpec;
}
