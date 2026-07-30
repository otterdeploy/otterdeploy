/**
 * Rename a resource inside a manifest, references and all.
 *
 * A resource's name is not just a label: other resources address it by that
 * name in their env values (`${database:primary.url}`, `${service:api.host}`).
 * Renaming the key alone would leave every one of those refs pointing at a
 * resource that no longer exists — the manifest would still validate, and the
 * breakage would surface at deploy time as an unresolvable ref.
 *
 * So a rename is one atomic transform: move the entry, then rewrite every ref
 * that named it. Pure and manifest-only — callers decide whether the rename is
 * ALLOWED (see `renamableState`), which is a question about deployed
 * infrastructure, not about the document.
 *
 * NOTE ON SCOPE: this handles the manifest's own `${kind:name.field}` grammar
 * (stack/manifest/refs.ts). The `${{name.VAR}}` form that `clone/plan.ts`
 * rewrites is the clone path's grammar and does not appear in manifests.
 */

import type { Manifest } from "../../stack/manifest";

import { ManifestVersionConflictError } from "./errors";
import { loadManifest, saveManifest, type ProjectScope } from "./manifest";
import { loadCurrentState } from "./manifest-state";
import { resolveProjectEnvironmentScope } from "./queries/resource";

export type RenameKind = "service" | "database" | "compose";

const SECTION: Record<RenameKind, "services" | "databases" | "composes"> = {
  service: "services",
  database: "databases",
  compose: "composes",
};

/**
 * Rewrite `${service:old…}` / `${database:old…}` refs in one env value.
 *
 * Deliberately a targeted regex rather than parse-and-re-emit: `parseRefs`
 * throws on malformed tokens, and a rename must not be the operation that
 * refuses to run because some unrelated value in the manifest has a typo in
 * it. Only the resource NAME is touched; the field/key tail is carried through
 * untouched, so `${service:api.port.metrics}` keeps its named port.
 */
export function rewriteRefsInValue(
  value: string,
  kind: RenameKind,
  from: string,
  to: string,
): string {
  // compose stacks aren't addressable by ref — nothing to rewrite.
  if (kind === "compose") return value;
  const escaped = from.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `${kind:name}` followed by `.` (a field/key) or the closing brace.
  const pattern = new RegExp(`(\\$\\{${kind}:)${escaped}(?=[.}])`, "g");
  return value.replace(pattern, `$1${to}`);
}

/** Env maps live under different keys per resource kind. */
function renameRefsInEnv(
  env: Record<string, string> | undefined,
  kind: RenameKind,
  from: string,
  to: string,
): Record<string, string> | undefined {
  if (!env) return env;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = typeof value === "string" ? rewriteRefsInValue(value, kind, from, to) : value;
  }
  return out;
}

/** Rewrite refs across every service and database env map in the manifest. */
function rewriteAllRefs(manifest: Manifest, kind: RenameKind, from: string, to: string): Manifest {
  const services = Object.fromEntries(
    Object.entries(manifest.services ?? {}).map(([name, spec]) => [
      name,
      { ...spec, env: renameRefsInEnv(spec.env, kind, from, to) },
    ]),
  );
  const databases = Object.fromEntries(
    Object.entries(manifest.databases ?? {}).map(([name, spec]) => [
      name,
      { ...spec, extraEnv: renameRefsInEnv(spec.extraEnv, kind, from, to) },
    ]),
  );
  return { ...manifest, services, databases } as Manifest;
}

export type RenameError = { code: "not-found" } | { code: "name-taken" } | { code: "same-name" };

/**
 * The manifest after renaming `from` → `to`, or an error explaining why not.
 *
 * `name-taken` checks EVERY section, not just the one being renamed: a service
 * and a database cannot share a name because they share the project's internal
 * DNS namespace — `${service:x.host}` and a database called `x` would be two
 * different answers to the same question.
 */
export function renameInManifest(args: {
  manifest: Manifest;
  kind: RenameKind;
  from: string;
  to: string;
}): { ok: true; manifest: Manifest } | { ok: false; error: RenameError } {
  const { manifest, kind, from, to } = args;
  if (from === to) return { ok: false, error: { code: "same-name" } };

  const section = SECTION[kind];
  const entries = (manifest[section] ?? {}) as Record<string, unknown>;
  if (!(from in entries)) return { ok: false, error: { code: "not-found" } };

  const taken = (["services", "databases", "composes"] as const).some((s) =>
    Object.hasOwn((manifest[s] ?? {}) as Record<string, unknown>, to),
  );
  if (taken) return { ok: false, error: { code: "name-taken" } };

  // Move the entry, preserving key order so the rename doesn't reshuffle the
  // manifest (and produce a noisy diff in the stack editor).
  const moved: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(entries)) {
    moved[name === from ? to : name] = spec;
  }

  const withMove = { ...manifest, [section]: moved } as Manifest;
  return { ok: true, manifest: rewriteAllRefs(withMove, kind, from, to) };
}

/**
 * Orchestrate a rename: load, check it's allowed, transform, save.
 *
 * Lives here rather than in the router so the router file stays inside its
 * length cap and so the "is this rename legal" reasoning sits next to the
 * transform it guards.
 */
export async function renameResource(
  scope: ProjectScope,
  input: { kind: RenameKind; from: string; to: string },
): Promise<
  | { ok: true; version: number }
  | { ok: false; code: "not-found" }
  | { ok: false; code: "rejected"; message: string }
> {
  const loaded = await loadManifest(scope);
  if (loaded.isErr() || !loaded.value.manifest) return { ok: false, code: "not-found" };
  const manifest = loaded.value.manifest;

  // Only a PENDING resource may be renamed. A deployed one has its container,
  // swarm service and volume names derived from this name (buildContainerName
  // / buildVolumeName), so renaming the manifest key alone would repoint the
  // project at infrastructure that doesn't exist — and for a database, away
  // from the volume holding its data.
  const envScope = await resolveProjectEnvironmentScope(scope.projectId, null);
  if (envScope) {
    const current = await loadCurrentState(scope.projectId, envScope);
    const deployed =
      input.kind === "database" ? current.databases?.[input.from] : current.services?.[input.from];
    if (deployed) {
      return {
        ok: false,
        code: "rejected",
        message: `"${input.from}" is already deployed. Renaming a running resource isn't supported yet — its container and volume names are derived from this name.`,
      };
    }
  }

  const renamed = renameInManifest({ manifest, kind: input.kind, from: input.from, to: input.to });
  if (!renamed.ok) {
    return {
      ok: false,
      code: "rejected",
      message: {
        "not-found": `No pending ${input.kind} named "${input.from}".`,
        "name-taken": `"${input.to}" is already used by another resource in this project.`,
        "same-name": "That's the name it already has.",
      }[renamed.error.code],
    };
  }

  const saved = await saveManifest(scope, {
    manifest: renamed.manifest,
    expectedVersion: loaded.value.version,
  });
  if (saved.isErr()) {
    return saved.error instanceof ManifestVersionConflictError
      ? {
          ok: false,
          code: "rejected",
          message: "The manifest changed underneath you — reload and retry.",
        }
      : { ok: false, code: "not-found" };
  }
  return { ok: true, version: saved.value.version };
}
