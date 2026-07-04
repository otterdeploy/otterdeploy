/**
 * Pure comparison + summary helpers for the manifest diff (see `./diff.ts`).
 * Split out so the diff entry point stays small; everything here is internal
 * to the diff and re-imported by `diff.ts`.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";

import type { CurrentService, CurrentServicePort } from "./diff";
import type { ComposeManifest, DatabaseManifest, ServiceManifest } from "./schema";

// ── Service field diff ─────────────────────────────────────────────────

type FieldChanges = Record<string, { from: unknown; to: unknown }>;

function diffSourceFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.source === "image" && current.source === "image") {
    if (desired.image !== current.image) {
      fc.image = { from: current.image, to: desired.image };
    }
  }
  if (desired.source === "git" && current.source === "git") {
    const desiredSubdir = desired.sourceSubdir ?? null;
    if (desiredSubdir !== current.sourceSubdir) {
      fc.sourceSubdir = { from: current.sourceSubdir, to: desiredSubdir };
    }
    // Per-service repo/branch. Only diffed when the manifest actually declares
    // `repo` — an omitted repo means "leave the existing binding alone" (repo
    // moved into the manifest recently; pre-migration manifests omit it and
    // must not read as "unset the repo"). See manifest-apply-services.ts, which
    // gates the write the same way.
    if (desired.repo !== undefined) {
      if (desired.repo !== current.repo) {
        fc.repo = { from: current.repo, to: desired.repo };
      }
      const desiredBranch = desired.branch ?? null;
      if (desiredBranch !== current.branch) {
        fc.branch = { from: current.branch, to: desiredBranch };
      }
    }
    const desiredImage = desired.imageRepository ?? null;
    if (desired.imageRepository !== undefined && desiredImage !== current.imageRepository) {
      fc.imageRepository = { from: current.imageRepository, to: desiredImage };
    }
  }
  if (desired.source === "git") {
    const desiredBuild = desired.build ?? null;
    if (!sameBuildConfig(desiredBuild, current.buildConfig)) {
      fc.buildConfig = { from: current.buildConfig, to: desiredBuild };
    }
  }
}

function diffExecFields(desired: ServiceManifest, current: CurrentService, fc: FieldChanges): void {
  const desiredReplicas = desired.replicas ?? 1;
  if (desiredReplicas !== current.replicas) {
    fc.replicas = { from: current.replicas, to: desiredReplicas };
  }

  const desiredCmd = desired.startCommand ?? null;
  if (!sameStringArray(desiredCmd, current.command)) {
    fc.command = { from: current.command, to: desiredCmd };
  }

  const desiredEntry = desired.entrypoint ?? null;
  if (!sameStringArray(desiredEntry, current.entrypoint)) {
    fc.entrypoint = { from: current.entrypoint, to: desiredEntry };
  }

  const portsDiff = diffPorts(desired.ports ?? [], current.ports);
  if (portsDiff) fc.ports = portsDiff;
}

function diffLifecycleFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  const desiredPreDeploy = desired.preDeploy ?? null;
  if (!sameStringArray(desiredPreDeploy, current.preDeploy)) {
    fc.preDeploy = { from: current.preDeploy, to: desiredPreDeploy };
  }

  const desiredPostDeploy = desired.postDeploy ?? null;
  if (!sameStringArray(desiredPostDeploy, current.postDeploy)) {
    fc.postDeploy = { from: current.postDeploy, to: desiredPostDeploy };
  }

  const desiredRestartWindow = desired.restart?.windowMs ?? null;
  if (desiredRestartWindow !== current.restartWindowMs) {
    fc.restartWindowMs = { from: current.restartWindowMs, to: desiredRestartWindow };
  }
}

function diffResourceLimitFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  const desiredDisk = desired.resources?.diskMb ?? null;
  if (desiredDisk !== current.diskLimitMb) {
    fc.diskLimitMb = { from: current.diskLimitMb, to: desiredDisk };
  }
  const desiredSwap = desired.resources?.swapMb ?? null;
  if (desiredSwap !== current.swapLimitMb) {
    fc.swapLimitMb = { from: current.swapLimitMb, to: desiredSwap };
  }
  const desiredPids = desired.resources?.pidsLimit ?? null;
  if (desiredPids !== current.pidsLimit) {
    fc.pidsLimit = { from: current.pidsLimit, to: desiredPids };
  }
}

/** Compute the changed-field map between a desired service manifest and the
 *  current resource. Empty object means no scalar/config field changed. */
export function diffServiceFields(desired: ServiceManifest, current: CurrentService): FieldChanges {
  const fc: FieldChanges = {};
  diffSourceFields(desired, current, fc);
  diffExecFields(desired, current, fc);
  diffLifecycleFields(desired, current, fc);
  diffResourceLimitFields(desired, current, fc);
  return fc;
}

// ── Env diff ───────────────────────────────────────────────────────────
//
//   manifest "${secret}"      = key must exist server-side (server holds value)
//   manifest plain value      = manifest is the source of truth
//   manifest missing key      = delete from server (manifest declares shape)

export interface EnvChange {
  key: string;
  action: "create" | "update" | "delete" | "no-op";
  details?: Record<string, unknown>;
}

export function diffEnv(
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
    const q = sortedB[i];
    if (!q) return false;
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

// ── Comparison helpers ─────────────────────────────────────────────────

function isSecretSentinel(value: string): boolean {
  return value.trim() === "${secret}";
}

function sameStringArray(a: string[] | null, b: string[] | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Compare buildConfigs semantically, independent of key order. The desired
// side comes from the manifest (keys in insertion order, discriminator
// first); the current side is read back from a postgres `jsonb` column,
// which returns keys in its own normalized order (e.g. `spa` before
// `builder`). A plain `JSON.stringify` comparison would treat
// `{builder,spa}` and `{spa,builder}` as different and surface a permanent
// phantom "update" that can never be applied away or discarded.
function sameBuildConfig(a: BuildConfig | null, b: BuildConfig | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return canonicalJson(a) === canonicalJson(b);
}

// Stable JSON: object keys sorted recursively, array order preserved.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

// ── Summaries ──────────────────────────────────────────────────────────

export function summarizeService(s: ServiceManifest): Record<string, unknown> {
  const summary: Record<string, unknown> = { replicas: s.replicas ?? 1 };
  if (s.source === "image") summary.image = s.image;
  if (s.source === "git" && s.repo) summary.repo = s.repo;
  if (s.source === "git" && s.branch) summary.branch = s.branch;
  if (s.source === "git" && s.sourceSubdir) summary.sourceSubdir = s.sourceSubdir;
  if (s.ports?.length) summary.ports = s.ports;
  if (s.env && Object.keys(s.env).length > 0) summary.envKeys = Object.keys(s.env);
  if (s.domains?.length) summary.domains = s.domains.map((d) => d.domain);
  return summary;
}

export function summarizeCompose(c: ComposeManifest): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (c.source === "git") summary.gitRepoUrl = c.gitRepoUrl;
  if (c.env && Object.keys(c.env).length > 0) summary.envKeys = Object.keys(c.env);
  if (c.exposed?.length) {
    summary.exposed = c.exposed.map((e) => `${e.service}:${e.port}`);
  }
  return summary;
}

export function summarizeDatabase(d: DatabaseManifest): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if ("version" in d && d.version) summary.version = d.version;
  if (d.publicEnabled) summary.publicEnabled = true;
  if (d.extraEnv && Object.keys(d.extraEnv).length > 0) {
    summary.extraEnvKeys = Object.keys(d.extraEnv);
  }
  return summary;
}
