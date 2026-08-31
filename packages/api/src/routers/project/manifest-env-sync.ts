/**
 * Back-syncing LIVE edits into the saved manifest.
 *
 * Every function here answers the same question: an operator just changed
 * something through the panel or the CLI — how does the manifest stop
 * disagreeing with reality? Without this the next diff stages phantom deletes
 * for live-added keys, or resurrects a live-deleted one on apply.
 *
 * Split out of manifest.ts on its line cap, and it splits cleanly: that file
 * is about loading, saving and versioning the document; this one is about
 * reconciling it with what actually happened.
 *
 * All of it is best-effort. A failure here must never fail the mutation that
 * already succeeded.
 */
import type { Manifest } from "../../stack/manifest";

import { isSecretSentinel, parseRefs } from "../../stack/manifest";
import { loadManifest, saveManifest, type ProjectScope } from "./manifest";

/**
 * Keep the saved manifest truthful after a live public-toggle on a database.
 *
 * Only patches when the manifest EXPLICITLY declares `publicEnabled` for this
 * database: an omitted key means "live-managed" (the diff skips it, same
 * convention as services), and inventing the key here would promote the field
 * to manifest control the user never asked for. Best-effort: a concurrent
 * manifest save wins the version race and this no-ops; the diff guard on
 * undefined still prevents phantom reverts.
 */
export async function syncManifestDatabasePublic(
  scope: ProjectScope,
  name: string,
  publicEnabled: boolean,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.databases?.[name];
  if (
    !manifest ||
    !entry ||
    entry.publicEnabled === undefined ||
    entry.publicEnabled === publicEnabled
  ) {
    return;
  }
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      databases: { ...manifest.databases, [name]: { ...entry, publicEnabled } },
    },
    expectedVersion: row.value.version,
  });
}

/** Same back-sync for a declared `extraEnv`: after a live env edit, patch the
 *  saved manifest's declared map to the applied one so the next diff doesn't
 *  stage a phantom revert. No-op when the manifest omits the key (live-managed)
 *  or already matches. */
export async function syncManifestDatabaseExtraEnv(
  scope: ProjectScope,
  name: string,
  extraEnv: Record<string, string>,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.databases?.[name];
  if (!manifest || !entry || entry.extraEnv === undefined) return;
  const declared = entry.extraEnv;
  const declaredKeys = Object.keys(declared);
  const nextKeys = Object.keys(extraEnv);
  const unchanged =
    declaredKeys.length === nextKeys.length && nextKeys.every((k) => declared[k] === extraEnv[k]);
  if (unchanged) return;
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      databases: { ...manifest.databases, [name]: { ...entry, extraEnv } },
    },
    expectedVersion: row.value.version,
  });
}

/**
 * The applied values, except where the declaration is OPAQUE.
 *
 * A declared `${secret}` or `${…ref}` must survive: the live row holds the
 * resolved value, so writing it back would destroy the declaration and put the
 * resolved secret in the manifest as cleartext.
 */
function mergeAppliedOverDeclared(
  declared: Record<string, string>,
  applied: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(applied)) {
    const declaredValue = declared[key];
    const opaque =
      declaredValue !== undefined &&
      (isSecretSentinel(declaredValue) || parseRefs(declaredValue).length > 0);
    next[key] = opaque ? declaredValue : value;
  }
  return next;
}

/** Which manifest slot a service's declared env lives in. */
export type ManifestEnvTarget =
  | { kind: "service"; name: string }
  | { kind: "stackChild"; stackName: string; composeService: string };

/**
 * Back-sync a stack CHILD's env into `composes[<stack>].services[<key>].env`.
 *
 * Unlike the top-level service case there is no "manifest omits env, so it is
 * live-managed" opt-out to respect: the slot did not exist until now, so an
 * absent entry means "never recorded", not "deliberately unmanaged". Writing
 * it is what makes the child's env survive `otd export` and DR restore.
 *
 * Declared `${secret}` / `${…ref}` values are preserved on a surviving key,
 * exactly as the service path does: the rows hold the resolved value and
 * overwriting the declaration would destroy it.
 */
async function syncStackChildEnv(
  scope: ProjectScope,
  manifest: Manifest,
  version: number,
  target: { stackName: string; composeService: string },
  applied: Record<string, string>,
): Promise<void> {
  if (!manifest) return;
  const stack = manifest.composes?.[target.stackName];
  if (!stack) return;
  const declared = stack.services?.[target.composeService]?.env ?? {};
  const next = mergeAppliedOverDeclared(declared, applied);
  const declaredKeys = Object.keys(declared);
  const nextKeys = Object.keys(next);
  const unchanged =
    declaredKeys.length === nextKeys.length && nextKeys.every((k) => declared[k] === next[k]);
  if (unchanged) return;
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      composes: {
        ...manifest.composes,
        [target.stackName]: {
          ...stack,
          services: {
            ...stack.services,
            [target.composeService]: { ...stack.services?.[target.composeService], env: next },
          },
        },
      },
    },
    expectedVersion: version,
  });
}

/**
 * Service twin of {@link syncManifestDatabaseExtraEnv}: after a LIVE env edit
 * (variables tab, CLI `env set`), patch the manifest's declared env to match
 * the applied rows so the next diff doesn't stage phantom deletes for
 * live-added keys, or worse, resurrect a live-deleted one on Apply.
 *
 * Declared `${secret}` and `${…ref}` values are PRESERVED when their key
 * survives: the rows hold the resolved/live value, and overwriting the
 * declaration would destroy it. No-op when the manifest omits env
 * (live-managed) or already matches. Best-effort on the version race, same as
 * the database sync.
 */
export async function syncManifestServiceEnv(
  scope: ProjectScope,
  /** Where in the manifest this service lives. A stack CHILD is not under
   *  `services` — it is `composes[stack].services[composeKey]` — which is why
   *  every child's env edit used to fall out of the manifest entirely
   *  (od-uhot): this function looked in one place and returned. */
  target: ManifestEnvTarget,
  applied: Record<string, string>,
  /** Keys the operator has flagged sensitive, from the live rows. */
  secretKeys: readonly string[] = [],
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  if (!manifest) return;
  if (target.kind === "stackChild") {
    await syncStackChildEnv(scope, manifest, row.value.version, target, applied);
    return;
  }
  const name = target.name;
  const entry = manifest.services?.[name];
  if (!entry || entry.env === undefined || Object.keys(entry.env).length === 0) {
    return;
  }
  const declared = entry.env;
  const next = mergeAppliedOverDeclared(declared, applied);
  // Which keys the operator marked sensitive, recorded so the next apply does
  // not re-insert them unflagged (od-w2r). Undefined when nothing is flagged,
  // so a manifest that never used the field does not grow an empty array.
  const nextSecrets = secretKeys.length > 0 ? [...secretKeys] : undefined;
  const declaredKeys = Object.keys(declared);
  const nextKeys = Object.keys(next);
  const unchanged =
    declaredKeys.length === nextKeys.length &&
    nextKeys.every((k) => declared[k] === next[k]) &&
    sameKeySet(entry.secrets, nextSecrets);
  if (unchanged) return;
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      services: {
        ...manifest.services,
        [name]: { ...entry, env: next, ...(nextSecrets ? { secrets: nextSecrets } : {}) },
      },
    },
    expectedVersion: row.value.version,
  });
}

/** Same keys, order-insensitive. Two lists that differ only in order are not
 *  a change worth bumping the manifest version for. */
function sameKeySet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((k, i) => k === right[i]);
}
