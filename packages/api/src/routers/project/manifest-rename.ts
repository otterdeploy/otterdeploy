/**
 * Rename a resource inside a manifest, references and all.
 *
 * A resource's name is not just a label: other resources address it by that
 * name in their env values (`${database:primary.url}`, `${service:api.host}`).
 * Renaming the key alone would leave every one of those refs pointing at a
 * resource that no longer exists. The manifest would still validate, and the
 * breakage would surface at deploy time as an unresolvable ref.
 *
 * So a rename is one atomic transform: move the entry, then rewrite every ref
 * that named it. Pure and manifest-only: callers decide whether the rename is
 * ALLOWED (see `renamableState`), which is a question about deployed
 * infrastructure, not about the document.
 *
 * NOTE ON SCOPE: this handles the manifest's own `${kind:name.field}` grammar
 * (stack/manifest/refs.ts). The `${{name.VAR}}` form that `clone/plan.ts`
 * rewrites is the clone path's grammar and does not appear in manifests.
 */

import type {
  ComposeManifest,
  DatabaseManifest,
  Manifest,
  ServiceManifest,
} from "../../stack/manifest";

export type RenameKind = "service" | "database" | "compose";

/** Any entry in any renamable manifest section. */
type SectionEntry = ServiceManifest | DatabaseManifest | ComposeManifest;

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
  // compose stacks aren't addressable by ref, nothing to rewrite.
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

/** Rename a map key in place, preserving iteration order for every other key. */
function moveKey<V>(section: Record<string, V>, from: string, to: string): Record<string, V> {
  const moved: Record<string, V> = {};
  for (const [name, spec] of Object.entries(section)) {
    moved[name === from ? to : name] = spec;
  }
  return moved;
}

/** Object.fromEntries with the section's own value type kept intact. */
function mapSection<V>(section: Record<string, V>, transform: (spec: V) => V): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [name, spec] of Object.entries(section)) {
    out[name] = transform(spec);
  }
  return out;
}

/** Rewrite refs across every service and database env map in the manifest. */
function rewriteAllRefs(manifest: Manifest, kind: RenameKind, from: string, to: string): Manifest {
  const services = mapSection(manifest.services ?? {}, (spec) => ({
    ...spec,
    env: renameRefsInEnv(spec.env, kind, from, to),
  }));
  const databases = mapSection(manifest.databases ?? {}, (spec) => ({
    ...spec,
    extraEnv: renameRefsInEnv(spec.extraEnv, kind, from, to),
  }));
  return { ...manifest, services, databases };
}

export type RenameError = { code: "not-found" } | { code: "name-taken" } | { code: "same-name" };

/**
 * The manifest after renaming `from` → `to`, or an error explaining why not.
 *
 * `name-taken` checks EVERY section, not just the one being renamed: a service
 * and a database cannot share a name because they share the project's internal
 * DNS namespace: `${service:x.host}` and a database called `x` would be two
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
  const entries: Record<string, SectionEntry> = manifest[section] ?? {};
  if (!(from in entries)) return { ok: false, error: { code: "not-found" } };

  const taken = (["services", "databases", "composes"] as const).some((s) =>
    Object.hasOwn(manifest[s] ?? {}, to),
  );
  if (taken) return { ok: false, error: { code: "name-taken" } };

  // Move the entry, preserving key order so the rename doesn't reshuffle the
  // manifest (and produce a noisy diff in the stack editor). Each section is
  // spread under its own literal key so the manifest keeps its exact map types.
  const withMove: Manifest =
    section === "services"
      ? { ...manifest, services: moveKey(manifest.services ?? {}, from, to) }
      : section === "databases"
        ? { ...manifest, databases: moveKey(manifest.databases ?? {}, from, to) }
        : { ...manifest, composes: moveKey(manifest.composes ?? {}, from, to) };
  return { ok: true, manifest: rewriteAllRefs(withMove, kind, from, to) };
}
