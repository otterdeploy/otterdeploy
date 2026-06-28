/**
 * Compose `${VAR}` interpolation against the project variable bag.
 *
 * Compose uses shell-style `${VAR}` / `${VAR:-default}`, and `$$` escapes a
 * literal `$`. We resolve refs from the project's variables; unknown refs
 * (with no default) become empty and are reported in `missing` so the UI can
 * offer to promote them to project variables. See docs/designs/compose.md.
 */

// $$ (escape) | ${NAME} | ${NAME:-default}
const REF = /\$(\$)?\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Resolve compose `${VAR}` / `${VAR:-default}` refs in a single string against
 * the project variables. `$$` escapes a literal `$`. Unknown refs (no default)
 * collapse to empty and are collected in `missing`. Compose applies this to
 * EVERY string field — image, command, ports, env — not just env values.
 */
export function interpolate(
  value: string,
  vars: Record<string, string>,
  missing?: Set<string>,
): string {
  return value.replace(
    REF,
    (_m: string, escape: string | undefined, name: string, def: string | undefined) => {
      // `$${VAR}` → literal `${VAR}` (compose escape), no substitution.
      if (escape) return `\${${name}${def != null ? `:-${def}` : ""}}`;
      const resolved = vars[name];
      if (resolved != null) return resolved;
      if (def != null) return def;
      missing?.add(name);
      return "";
    },
  );
}

export function substituteComposeEnv(
  env: Record<string, string>,
  projectVars: Record<string, string>,
): { env: Record<string, string>; missing: string[] } {
  const out: Record<string, string> = {};
  const missing = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    out[key] = interpolate(value, projectVars, missing);
  }
  return { env: out, missing: [...missing] };
}

export interface ComposeVarRef {
  name: string;
  /** The `:-default` if the file provides one, else null (value required). */
  default: string | null;
}

/**
 * Every `${VAR}` ref across a parsed compose file's string fields (image,
 * command, entrypoint, env values) — unique by name, preferring a default if
 * any occurrence supplies one. Drives the wizard's "fill in these variables"
 * step. `$$`-escaped refs are ignored.
 */
export function collectVarRefs(parsed: {
  services: Array<{
    image: string | null;
    command: string[] | null;
    entrypoint: string[] | null;
    env: Record<string, string>;
  }>;
}): ComposeVarRef[] {
  const found = new Map<string, string | null>();
  const scan = (value: string | null | undefined) => {
    if (!value) return;
    for (const m of value.matchAll(REF)) {
      if (m[1]) continue; // `$$` escape — not a real ref
      const name = m[2];
      if (!name) continue;
      const def = m[3] ?? null;
      const prev = found.get(name);
      // First sighting, or fill in a default we didn't have yet.
      if (!found.has(name) || (prev == null && def != null)) {
        found.set(name, def);
      }
    }
  };
  for (const svc of parsed.services) {
    scan(svc.image);
    svc.command?.forEach(scan);
    svc.entrypoint?.forEach(scan);
    Object.values(svc.env).forEach(scan);
  }
  return [...found].map(([name, def]) => ({ name, default: def }));
}
