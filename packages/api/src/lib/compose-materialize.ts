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

import { mkdir, writeFile } from "node:fs/promises";
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
