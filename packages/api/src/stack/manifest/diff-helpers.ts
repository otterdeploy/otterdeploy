/**
 * Pure comparison + summary helpers for the manifest diff (see `./diff.ts`).
 * Split out so the diff entry point stays small; everything here is internal
 * to the diff and re-imported by `diff.ts`.
 */

import type { ChangeDetails, CurrentService, CurrentServicePort } from "./diff";
import type { ComposeManifest, DatabaseManifest, ServiceManifest } from "./schema";

import { diffSourceFields, type FieldChanges } from "./diff-source";

// ── Service field diff ─────────────────────────────────────────────────

// Every field below follows the DECLARED-ONLY convention (established by
// database publicEnabled/extraEnv and the git binding): a key the manifest
// omits is live-managed. The diff skips it and apply leaves it alone. The
// old `?? default` comparisons staged phantom updates for every live-managed
// field, and because apply's patch builders already treated omitted fields as
// "leave alone", those phantoms could never be applied away, a permanently
// stuck pending bar.

function diffExecFields(desired: ServiceManifest, current: CurrentService, fc: FieldChanges): void {
  if (desired.replicas !== undefined && desired.replicas !== current.replicas) {
    fc.replicas = { from: current.replicas, to: desired.replicas };
  }

  if (
    desired.startCommand !== undefined &&
    !sameStringArray(desired.startCommand, current.command)
  ) {
    fc.command = { from: current.command, to: desired.startCommand };
  }

  if (
    desired.entrypoint !== undefined &&
    !sameStringArray(desired.entrypoint, current.entrypoint)
  ) {
    fc.entrypoint = { from: current.entrypoint, to: desired.entrypoint };
  }

  if (desired.ports !== undefined) {
    const portsDiff = diffPorts(desired.ports, current.ports);
    if (portsDiff) fc.ports = portsDiff;
  }
}

function diffLifecycleFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.preDeploy !== undefined && !sameStringArray(desired.preDeploy, current.preDeploy)) {
    fc.preDeploy = { from: current.preDeploy, to: desired.preDeploy };
  }

  if (
    desired.postDeploy !== undefined &&
    !sameStringArray(desired.postDeploy, current.postDeploy)
  ) {
    fc.postDeploy = { from: current.postDeploy, to: desired.postDeploy };
  }

  if (desired.restart !== undefined) {
    const desiredRestartWindow = desired.restart.windowMs ?? null;
    if (desiredRestartWindow !== current.restartWindowMs) {
      fc.restartWindowMs = { from: current.restartWindowMs, to: desiredRestartWindow };
    }
  }
}

function diffResourceLimitFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.resources === undefined) return;
  const desiredDisk = desired.resources.diskMb ?? null;
  if (desiredDisk !== current.diskLimitMb) {
    fc.diskLimitMb = { from: current.diskLimitMb, to: desiredDisk };
  }
  const desiredSwap = desired.resources.swapMb ?? null;
  if (desiredSwap !== current.swapLimitMb) {
    fc.swapLimitMb = { from: current.swapLimitMb, to: desiredSwap };
  }
  const desiredPids = desired.resources.pidsLimit ?? null;
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
  details?: ChangeDetails;
}

/**
 * Compare declared env against the live rows.
 *
 * `resolveValue` (optional) resolves `${database:…}` / `${service:…}` refs the
 * way apply will (returns null when unresolvable). Without it, a declared ref
 * could NEVER match the stored row. Apply writes the RESOLVED value into
 * `service_env_var`, so a raw-text compare staged a phantom "update" on every
 * diff and re-rolled the container on every apply, forever.
 */
export function diffEnv(
  desired: Record<string, string>,
  current: Record<string, string>,
  resolveValue?: (raw: string) => string | null,
  /** Per-key provenance of the LIVE rows (serviceEnvVar.source). A key the
   *  manifest did not write is not the manifest's to delete — see the delete
   *  loop. Omitted for surfaces that have no provenance (database extraEnv is
   *  a jsonb blob with no per-key owner), which keeps today's behaviour. */
  currentSource?: Record<string, string | undefined>,
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
            note: "declared as ${secret}: set via `otterdeploy env set` before apply succeeds",
          },
        });
      }
      // If it exists, do nothing. Value is the server's, manifest stays out.
      continue;
    }
    // Compare what apply would actually write; fall back to the raw text when
    // no resolver is supplied or the ref doesn't resolve (the unresolved ref
    // surfaces as an apply-time skip with a reason, not a silent no-op).
    const target = resolveValue ? (resolveValue(declared) ?? declared) : declared;
    if (existing === undefined) {
      out.push({ key, action: "create", details: { value: declared } });
      continue;
    }
    if (existing !== target) {
      out.push({
        key,
        action: "update",
        details: { from: existing, to: declared },
      });
    }
  }

  for (const key of Object.keys(current)) {
    if (key in desired) continue;
    // od-y64.8: the manifest prunes what the MANIFEST wrote. A key set with
    // `otterdeploy env set` is undeclared by construction — that is what
    // imperative means — so staging it for delete wiped operator secrets on
    // the next deploy, silently. Rows of unknown provenance are treated as
    // the operator's too: leaving a stale key costs a stale key, and the
    // other way round costs a secret.
    if (currentSource && currentSource[key] !== "manifest") continue;
    out.push({ key, action: "delete" });
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

// ── Summaries ──────────────────────────────────────────────────────────
//
// Concrete field sets (not free-form JSON): each summary carries exactly the
// headline fields a "create" diff entry shows. All JSON-shaped, so they
// spread directly into a `ChangeDetails` payload.

// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
export type ServiceSummary = {
  replicas: number;
  image?: string;
  repo?: string;
  branch?: string;
  sourceSubdir?: string;
  ports?: ServiceManifest["ports"];
  envKeys?: string[];
  domains?: string[];
};

// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
export type ComposeSummary = {
  gitRepoUrl?: string | null;
  envKeys?: string[];
  exposed?: string[];
};

// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
export type DatabaseSummary = {
  version?: string;
  publicEnabled?: boolean;
  extraEnvKeys?: string[];
};

export function summarizeService(s: ServiceManifest): ServiceSummary {
  const summary: ServiceSummary = { replicas: s.replicas ?? 1 };
  if (s.source === "image") summary.image = s.image;
  if (s.source === "git" && s.repo) summary.repo = s.repo;
  if (s.source === "git" && s.branch) summary.branch = s.branch;
  if (s.source === "git" && s.sourceSubdir) summary.sourceSubdir = s.sourceSubdir;
  if (s.ports?.length) summary.ports = s.ports;
  if (s.env && Object.keys(s.env).length > 0) summary.envKeys = Object.keys(s.env);
  if (s.domains?.length) summary.domains = s.domains.map((d) => d.domain);
  return summary;
}

export function summarizeCompose(c: ComposeManifest): ComposeSummary {
  const summary: ComposeSummary = {};
  if (c.source === "git") summary.gitRepoUrl = c.gitRepoUrl;
  if (c.env && Object.keys(c.env).length > 0) summary.envKeys = Object.keys(c.env);
  if (c.exposed?.length) {
    summary.exposed = c.exposed.map((e) => `${e.service}:${e.port}`);
  }
  return summary;
}

export function summarizeDatabase(d: DatabaseManifest): DatabaseSummary {
  const summary: DatabaseSummary = {};
  if ("version" in d && d.version) summary.version = d.version;
  if (d.publicEnabled) summary.publicEnabled = true;
  if (d.extraEnv && Object.keys(d.extraEnv).length > 0) {
    summary.extraEnvKeys = Object.keys(d.extraEnv);
  }
  return summary;
}
