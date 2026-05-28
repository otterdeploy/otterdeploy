/**
 * Plan-only diff between a resolved manifest and the project's current
 * resource state. Pure function — does not write.
 *
 * The reconciler in Phase 4b/c will execute these change items; for
 * Phase 4a the same routine powers `manifest.diff` so users get a
 * truthful preview before committing to apply.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";

import type { Manifest, ServiceManifest, DatabaseManifest } from "./schema";

export type ChangeKind = "create" | "update" | "delete" | "no-op";
export type ChangeResource = "service" | "database" | "env";

export interface Change {
  kind: ChangeKind;
  resource: ChangeResource;
  name: string;
  details?: Record<string, unknown>;
}

// ── Current-state view ─────────────────────────────────────────────────
//
// Shape the caller is responsible for materializing from DB rows. Keeping
// the diff function pure makes it trivially testable; the DB-loading
// adapter sits in `routers/project/manifest.ts`.

export interface CurrentServicePort {
  containerPort: number;
  protocol: "tcp" | "udp";
  appProtocol: "http" | "tcp";
  isPrimary: boolean;
  name?: string;
}

export interface CurrentService {
  name: string;
  source: "image" | "git";
  image: string | null;
  sourceSubdir: string | null;
  replicas: number;
  command: string[] | null;
  entrypoint: string[] | null;
  ports: CurrentServicePort[];
  env: Record<string, string>;
  publicEnabled: boolean;
  // New manifest-tracked fields. Null/undefined means "not set on the
  // current resource"; diff treats them like any other field.
  preDeploy: string[] | null;
  buildConfig: BuildConfig | null;
  restartWindowMs: number | null;
  diskLimitMb: number | null;
  swapLimitMb: number | null;
  pidsLimit: number | null;
}

export interface CurrentDatabase {
  name: string;
  engine: "postgres" | "redis" | "mariadb" | "mongodb";
  publicEnabled: boolean;
  extraEnv: Record<string, string>;
}

export interface CurrentState {
  services: Record<string, CurrentService>;
  databases: Record<string, CurrentDatabase>;
}

// ── Diff entry point ───────────────────────────────────────────────────

export function diffManifest(manifest: Manifest, current: CurrentState): Change[] {
  const changes: Change[] = [];

  diffNamedMap({
    desired: manifest.services,
    current: current.services,
    kind: "service",
    cmp: diffService,
    create: (name, desired) => ({
      kind: "create",
      resource: "service",
      name,
      details: { source: desired.source, ...summarizeService(desired) },
    }),
  }).forEach((c) => changes.push(c));

  diffNamedMap({
    desired: manifest.databases,
    current: current.databases,
    kind: "database",
    cmp: diffDatabase,
    create: (name, desired) => ({
      kind: "create",
      resource: "database",
      name,
      details: { engine: desired.engine, ...summarizeDatabase(desired) },
    }),
  }).forEach((c) => changes.push(c));

  return changes;
}

// ── Generic resource-map diff (services + databases share this) ────────

interface DiffMapArgs<TDesired, TCurrent> {
  desired: Record<string, TDesired>;
  current: Record<string, TCurrent>;
  kind: ChangeResource;
  cmp: (name: string, desired: TDesired, current: TCurrent) => Change[];
  create: (name: string, desired: TDesired) => Change;
}

function diffNamedMap<TDesired, TCurrent>({
  desired,
  current,
  kind,
  cmp,
  create,
}: DiffMapArgs<TDesired, TCurrent>): Change[] {
  const out: Change[] = [];
  for (const [name, value] of Object.entries(desired)) {
    const existing = current[name];
    if (!existing) {
      out.push(create(name, value));
      continue;
    }
    out.push(...cmp(name, value, existing));
  }
  for (const name of Object.keys(current)) {
    if (!(name in desired)) {
      out.push({ kind: "delete", resource: kind, name });
    }
  }
  return out;
}

// ── Service diff ───────────────────────────────────────────────────────

function diffService(name: string, desired: ServiceManifest, current: CurrentService): Change[] {
  // Discriminator change → represent as delete+create. The reconciler will
  // execute them in that order to avoid a hybrid intermediate state.
  if (desired.source !== current.source) {
    return [
      { kind: "delete", resource: "service", name, details: { reason: "source-changed" } },
      {
        kind: "create",
        resource: "service",
        name,
        details: { source: desired.source, ...summarizeService(desired) },
      },
    ];
  }

  const fieldChanges: Record<string, { from: unknown; to: unknown }> = {};

  if (desired.source === "image" && current.source === "image") {
    if (desired.image !== current.image) {
      fieldChanges.image = { from: current.image, to: desired.image };
    }
  }
  if (desired.source === "git" && current.source === "git") {
    const desiredSubdir = desired.sourceSubdir ?? null;
    if (desiredSubdir !== current.sourceSubdir) {
      fieldChanges.sourceSubdir = { from: current.sourceSubdir, to: desiredSubdir };
    }
  }

  const desiredReplicas = desired.replicas ?? 1;
  if (desiredReplicas !== current.replicas) {
    fieldChanges.replicas = { from: current.replicas, to: desiredReplicas };
  }

  const desiredCmd = desired.startCommand ?? null;
  if (!sameStringArray(desiredCmd, current.command)) {
    fieldChanges.command = { from: current.command, to: desiredCmd };
  }
  const desiredEntry = desired.entrypoint ?? null;
  if (!sameStringArray(desiredEntry, current.entrypoint)) {
    fieldChanges.entrypoint = { from: current.entrypoint, to: desiredEntry };
  }

  const portsDiff = diffPorts(desired.ports ?? [], current.ports);
  if (portsDiff) fieldChanges.ports = portsDiff;

  const desiredPreDeploy = desired.preDeploy ?? null;
  if (!sameStringArray(desiredPreDeploy, current.preDeploy)) {
    fieldChanges.preDeploy = { from: current.preDeploy, to: desiredPreDeploy };
  }

  const desiredRestartWindow = desired.restart?.windowMs ?? null;
  if (desiredRestartWindow !== current.restartWindowMs) {
    fieldChanges.restartWindowMs = { from: current.restartWindowMs, to: desiredRestartWindow };
  }

  const desiredDisk = desired.resources?.diskMb ?? null;
  if (desiredDisk !== current.diskLimitMb) {
    fieldChanges.diskLimitMb = { from: current.diskLimitMb, to: desiredDisk };
  }
  const desiredSwap = desired.resources?.swapMb ?? null;
  if (desiredSwap !== current.swapLimitMb) {
    fieldChanges.swapLimitMb = { from: current.swapLimitMb, to: desiredSwap };
  }
  const desiredPids = desired.resources?.pidsLimit ?? null;
  if (desiredPids !== current.pidsLimit) {
    fieldChanges.pidsLimit = { from: current.pidsLimit, to: desiredPids };
  }

  if (desired.source === "git") {
    const desiredBuild = desired.build ?? null;
    if (!sameBuildConfig(desiredBuild, current.buildConfig)) {
      fieldChanges.buildConfig = { from: current.buildConfig, to: desiredBuild };
    }
  }

  const envChanges = diffEnv(desired.env ?? {}, current.env);
  const out: Change[] = [];

  if (Object.keys(fieldChanges).length > 0) {
    out.push({ kind: "update", resource: "service", name, details: { fields: fieldChanges } });
  }

  for (const change of envChanges) {
    out.push({
      kind: change.action,
      resource: "env",
      name: `${name}.${change.key}`,
      details: change.details,
    });
  }

  if (out.length === 0) {
    out.push({ kind: "no-op", resource: "service", name });
  }
  return out;
}

// ── Database diff ──────────────────────────────────────────────────────

function diffDatabase(
  name: string,
  desired: DatabaseManifest,
  current: CurrentDatabase,
): Change[] {
  if (desired.engine !== current.engine) {
    return [
      { kind: "delete", resource: "database", name, details: { reason: "engine-changed" } },
      {
        kind: "create",
        resource: "database",
        name,
        details: { engine: desired.engine, ...summarizeDatabase(desired) },
      },
    ];
  }

  const fieldChanges: Record<string, { from: unknown; to: unknown }> = {};
  const desiredPublic = desired.publicEnabled ?? false;
  if (desiredPublic !== current.publicEnabled) {
    fieldChanges.publicEnabled = { from: current.publicEnabled, to: desiredPublic };
  }

  const envChanges = diffEnv(desired.extraEnv ?? {}, current.extraEnv);
  const out: Change[] = [];

  if (Object.keys(fieldChanges).length > 0) {
    out.push({
      kind: "update",
      resource: "database",
      name,
      details: { fields: fieldChanges },
    });
  }

  for (const change of envChanges) {
    out.push({
      kind: change.action,
      resource: "env",
      name: `${name}.${change.key}`,
      details: change.details,
    });
  }

  if (out.length === 0) {
    out.push({ kind: "no-op", resource: "database", name });
  }
  return out;
}

// ── Env diff ───────────────────────────────────────────────────────────
//
//   manifest "${secret}"      = key must exist server-side (server holds value)
//   manifest plain value      = manifest is the source of truth
//   manifest missing key      = delete from server (manifest declares shape)

type EnvChange = {
  key: string;
  action: "create" | "update" | "delete" | "no-op";
  details?: Record<string, unknown>;
};

function diffEnv(
  desired: Record<string, string>,
  current: Record<string, string>,
): EnvChange[] {
  const out: EnvChange[] = [];

  for (const [key, declared] of Object.entries(desired)) {
    const existing = current[key];
    if (isSecretSentinel(declared)) {
      // Declared as managed-server-side; existence is required, value is opaque.
      if (existing === undefined) {
        out.push({
          key,
          action: "create",
          details: {
            secret: true,
            note: "declared as ${secret} — set via `otterdeploy env set` before apply succeeds",
          },
        });
      }
      // If it exists, do nothing — value is the server's, manifest stays out.
      continue;
    }
    if (existing === undefined) {
      out.push({ key, action: "create", details: { value: declared } });
      continue;
    }
    if (existing !== declared) {
      out.push({
        key,
        action: "update",
        details: { from: existing, to: declared },
      });
    }
  }

  for (const key of Object.keys(current)) {
    if (!(key in desired)) {
      out.push({ key, action: "delete" });
    }
  }

  return out;
}

// ── Port diff (replace-wholesale comparison) ───────────────────────────

interface ManifestPortLike {
  container: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  primary?: boolean;
  name?: string;
}

function diffPorts(
  desired: ManifestPortLike[],
  current: CurrentServicePort[],
): { from: CurrentServicePort[]; to: CurrentServicePort[] } | null {
  const normalized: CurrentServicePort[] = desired.map((p) => ({
    containerPort: p.container,
    protocol: p.protocol ?? "tcp",
    appProtocol: p.appProtocol ?? "http",
    isPrimary: p.primary ?? false,
    name: p.name,
  }));

  if (samePorts(normalized, current)) return null;
  return { from: current, to: normalized };
}

function samePorts(a: CurrentServicePort[], b: CurrentServicePort[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort(comparePort);
  const sortedB = [...b].sort(comparePort);
  return sortedA.every((p, i) => {
    const q = sortedB[i]!;
    return (
      p.containerPort === q.containerPort &&
      p.protocol === q.protocol &&
      p.appProtocol === q.appProtocol &&
      p.isPrimary === q.isPrimary &&
      (p.name ?? null) === (q.name ?? null)
    );
  });
}

function comparePort(a: CurrentServicePort, b: CurrentServicePort): number {
  if (a.containerPort !== b.containerPort) return a.containerPort - b.containerPort;
  return a.protocol.localeCompare(b.protocol);
}

// ── Helpers ────────────────────────────────────────────────────────────

function isSecretSentinel(value: string): boolean {
  return value.trim() === "${secret}";
}

function sameStringArray(a: string[] | null, b: string[] | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Both shapes are small JSON blobs (≤ 6 fields). Deep-compare via stable
// JSON; key order-sensitive but the manifest-write path always orders
// keys the same way (discriminator first via the zod shape).
function sameBuildConfig(a: BuildConfig | null, b: BuildConfig | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function summarizeService(s: ServiceManifest): Record<string, unknown> {
  const summary: Record<string, unknown> = { replicas: s.replicas ?? 1 };
  if (s.source === "image") summary.image = s.image;
  if (s.source === "git" && s.sourceSubdir) summary.sourceSubdir = s.sourceSubdir;
  if (s.ports?.length) summary.ports = s.ports;
  if (s.env && Object.keys(s.env).length > 0) summary.envKeys = Object.keys(s.env);
  return summary;
}

function summarizeDatabase(d: DatabaseManifest): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if ("version" in d && d.version) summary.version = d.version;
  if (d.publicEnabled) summary.publicEnabled = true;
  if (d.extraEnv && Object.keys(d.extraEnv).length > 0) {
    summary.extraEnvKeys = Object.keys(d.extraEnv);
  }
  return summary;
}
