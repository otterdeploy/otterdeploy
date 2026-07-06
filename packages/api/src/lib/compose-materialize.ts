/**
 * Materialize a multi-file INLINE compose stack to a host directory.
 *
 * otterdeploy compiles compose → swarm/docker specs rather than running
 * `docker compose`, so supporting files (a `build:` Dockerfile + context, an
 * `env_file` target, a bind-mounted script) only become real when written to
 * disk. This lays the `files` tree down so:
 *   - the compose compiler can read `env_file` targets + point host binds at
 *     the materialized path, and
 *   - the build worker can `docker build` a `build:` context from it.
 *
 * Paths are sanitized to stay inside `dir` — a stack can't write outside its
 * own tree via `..` traversal or absolute paths.
 */
import type { ComposeFile } from "@otterdeploy/shared/compose";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Sanitize a stack-relative path to a safe segment under `root`, or null when
 *  it would escape (absolute, `..` traversal, or empty). */
export function safeJoin(root: string, rel: string): string | null {
  const dest = resolve(root, rel.replace(/^[/\\]+/, ""));
  if (dest !== root && !dest.startsWith(root + sep)) return null;
  return dest;
}

/**
 * Write every file to `dir` (creating parent folders). Returns the resolved
 * root. Files whose path escapes the root are skipped (defensive; the wizard
 * validates paths client-side too).
 */
export async function materializeComposeFiles(
  files: ComposeFile[],
  dir: string,
): Promise<string> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (const f of files) {
    const dest = safeJoin(root, f.path);
    if (!dest || dest === root) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
  }
  return root;
}

/**
 * Resolve a bind mount's compose `source` (a `./relative` or `/abs` host path)
 * to an absolute path inside the materialized stack `dir`. Absolute-looking
 * sources are treated as stack-relative too (a stack can't reach the real host
 * fs). Returns null if it would escape the tree.
 */
export function resolveBindSource(source: string, dir: string): string | null {
  return safeJoin(resolve(dir), source.replace(/^\.\/+/, ""));
}

/**
 * Read + parse `env_file` targets (relative to the materialized stack `dir`)
 * into one `{K:V}` map. Later files win (compose order). Missing files are
 * skipped; blank/`#` lines ignored; matching surrounding quotes stripped.
 */
export async function readEnvFiles(
  paths: string[],
  dir: string,
): Promise<Record<string, string>> {
  const root = resolve(dir);
  const out: Record<string, string> = {};
  for (const p of paths) {
    const abs = safeJoin(root, p);
    if (!abs) continue;
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key) out[key] = val;
    }
  }
  return out;
}
