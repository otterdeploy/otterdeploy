/**
 * Plan-only diff between a resolved manifest and the project's current
 * resource state. Pure function — does not write.
 *
 * The reconciler in Phase 4b/c will execute these change items; for
 * Phase 4a the same routine powers `manifest.diff` so users get a
 * truthful preview before committing to apply.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import type { Manifest, ServiceManifest, DatabaseManifest, ComposeManifest } from "./schema";

import {
  diffEnv,
  diffServiceFields,
  summarizeCompose,
  summarizeDatabase,
  summarizeService,
} from "./diff-helpers";

export type ChangeKind = "create" | "update" | "delete" | "no-op";
export type ChangeResource = "service" | "database" | "env" | "compose";

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
  // Current git binding as a portable `owner/repo` string (resolved from the
  // service row's gitRepoId → git_repo.fullName in manifest-state.ts) + branch,
  // so the pure diff can compare against the manifest's portable `repo`/`branch`
  // without a DB lookup. Null when the service isn't git-bound.
  repo: string | null;
  branch: string | null;
  imageRepository: string | null;
  replicas: number;
  command: string[] | null;
  entrypoint: string[] | null;
  ports: CurrentServicePort[];
  env: Record<string, string>;
  publicEnabled: boolean;
  // Per-service PR-preview opt-in (serviceResource.previewsEnabled). Diffed
  // only when the manifest declares `previews` — see diffGitBinding.
  previewsEnabled: boolean;
  // New manifest-tracked fields. Null/undefined means "not set on the
  // current resource"; diff treats them like any other field.
  preDeploy: string[] | null;
  postDeploy: string[] | null;
  buildConfig: BuildConfig | null;
  restartWindowMs: number | null;
  diskLimitMb: number | null;
  swapLimitMb: number | null;
  pidsLimit: number | null;
}

export interface CurrentDatabase {
  name: string;
  engine: DatabaseEngine;
  publicEnabled: boolean;
  extraEnv: Record<string, string>;
}

/**
 * Current-state view of a compose stack. Only identity is tracked: compose
 * stacks are diffed at create granularity (see {@link diffComposes}), so the
 * diff never needs the stack's contents — just whether one by this name
 * already exists.
 */
export interface CurrentCompose {
  name: string;
}

export interface CurrentState {
  services: Record<string, CurrentService>;
  databases: Record<string, CurrentDatabase>;
  composes: Record<string, CurrentCompose>;
}

// ── Diff entry point ───────────────────────────────────────────────────

export interface DiffOptions {
  /**
   * Resolve `${database:…}` / `${service:…}` refs in declared env values the
   * same way apply's write path will (null = unresolvable). Apply stores the
   * RESOLVED value in the env rows, so without this a declared ref never
   * text-matches its row — a phantom "update" that survived every apply.
   */
  resolveEnvValue?: (raw: string) => string | null;
}

/**
 * A declared env map, normalized for the declared-only convention: `undefined`
 * OR an empty `{}` both mean "live-managed" — the env editor owns the keys and
 * the diff/apply must not touch them. Nobody writes `env: {}` to mean "wipe
 * everything"; historically it just marked "no env declared at create time",
 * and treating it as authoritative staged a delete for every live-added var.
 */
export function declaredEnvOf(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return env !== undefined && Object.keys(env).length > 0 ? env : undefined;
}

export function diffManifest(
  manifest: Manifest,
  current: CurrentState,
  opts: DiffOptions = {},
): Change[] {
  const changes: Change[] = [];

  diffNamedMap({
    desired: manifest.services,
    current: current.services,
    kind: "service",
    cmp: (name, desired, existing) => diffService(name, desired, existing, opts),
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
    cmp: (name, desired, existing) => diffDatabase(name, desired, existing, opts),
    create: (name, desired) => ({
      kind: "create",
      resource: "database",
      name,
      details: { engine: desired.engine, ...summarizeDatabase(desired) },
    }),
  }).forEach((c) => changes.push(c));

  diffComposes(manifest.composes, current.composes).forEach((c) => changes.push(c));

  return changes;
}

// ── Compose diff (create-only) ─────────────────────────────────────────
//
// Compose stacks are diffed at a deliberately coarse granularity: a stack
// declared in the manifest but absent from current state is a `create`;
// anything else is a `no-op`. Two things fall out of this on purpose:
//
//   - No UPDATE. The stack's `${VAR}` values and per-service env become
//     editable, real resources only AFTER the first deploy (each compose
//     service materializes as its own service_resource). Editing the file
//     itself rides the stack's own redeploy, not the manifest — so the diff
//     never emits a compose update and can't manufacture a phantom one.
//   - No DELETE. Stacks created before compose joined the manifest live in
//     current state but not in any saved manifest; emitting deletes for them
//     would show every pre-existing stack as "pending delete". Deletion stays
//     on the stack node's own delete action.
function diffComposes(
  desired: Record<string, ComposeManifest>,
  current: Record<string, CurrentCompose>,
): Change[] {
  const out: Change[] = [];
  for (const [name, spec] of Object.entries(desired)) {
    if (current[name]) {
      out.push({ kind: "no-op", resource: "compose", name });
      continue;
    }
    out.push({
      kind: "create",
      resource: "compose",
      name,
      details: { source: spec.source, ...summarizeCompose(spec) },
    });
  }
  return out;
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

function diffService(
  name: string,
  desired: ServiceManifest,
  current: CurrentService,
  opts: DiffOptions,
): Change[] {
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

  const fieldChanges = diffServiceFields(desired, current);

  // Declared-only, same convention as database extraEnv: an absent (or empty)
  // env map means the live env editor owns the keys. Diffing it as `{}` staged
  // a phantom delete for EVERY live-added var — for a service whose vars were
  // set post-create, that was the entire env, pending forever.
  const declaredEnv = declaredEnvOf(desired.env);
  const envChanges =
    declaredEnv === undefined ? [] : diffEnv(declaredEnv, current.env, opts.resolveEnvValue);
  const out: Change[] = [];

  if (Object.keys(fieldChanges).length > 0) {
    out.push({ kind: "update", resource: "service", name, details: { fields: fieldChanges } });
  }

  for (const change of envChanges) {
    out.push({
      kind: change.action,
      resource: "env",
      name: `${name}.${change.key}`,
      // parent/key let the UI attach the env row to the owning resource
      // without re-parsing the dotted name (keys may themselves contain dots);
      // owner lets the reconciler group env changes under their resource.
      details: { ...change.details, parent: "service", key: change.key, owner: name },
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
  opts: DiffOptions,
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
  // publicEnabled is manifest-managed only when the manifest declares it.
  // Omitted → the toggle is live-managed (same convention as service
  // publicEnabled, which diffServiceFields skips entirely); defaulting the
  // absent key to `false` here used to stage a phantom update that REVERTED
  // a live public-toggle on the next Apply.
  if (desired.publicEnabled !== undefined && desired.publicEnabled !== current.publicEnabled) {
    fieldChanges.publicEnabled = { from: current.publicEnabled, to: desired.publicEnabled };
  }

  // Same declared-only convention as publicEnabled: an absent extraEnv means
  // the live env editor owns the keys. Diffing an absent map as `{}` used to
  // stage a phantom delete for every live-added key — and Apply wiped them
  // (rolling the container for good measure).
  const envChanges =
    desired.extraEnv === undefined
      ? []
      : diffEnv(desired.extraEnv, current.extraEnv, opts.resolveEnvValue);
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
      details: { ...change.details, parent: "database", key: change.key, owner: name },
    });
  }

  if (out.length === 0) {
    out.push({ kind: "no-op", resource: "database", name });
  }
  return out;
}
