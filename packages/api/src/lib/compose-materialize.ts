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
 * Paths are sanitized to stay inside `dir`. A stack can't write outside its
 * own tree via `..` traversal or absolute paths.
 */
import type { ComposeFile } from "@otterdeploy/shared/compose";

import { Result } from "better-result";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Sanitize a stack-relative path to a safe segment under `root`, or null when
 *  it would escape (absolute, `..` traversal, or empty). */
function safeJoin(root: string, rel: string): string | null {
  const dest = resolve(root, rel.replace(/^[/\\]+/, ""));
  if (dest !== root && !dest.startsWith(root + sep)) return null;
  return dest;
}

/**
 * Write every file to `dir` (creating parent folders). Returns the resolved
 * root. Files whose path escapes the root are skipped (defensive; the wizard
 * validates paths client-side too).
 */
export async function materializeComposeFiles(files: ComposeFile[], dir: string): Promise<string> {
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

/** Where each relative bind source of a git stack ended up. */
export interface RepoBindStaging {
  /** Compose sources now copied under the stack's own dir, mountable. */
  staged: Set<string>;
  /** Compose sources that are not a file or folder in the checkout (a data
   *  dir compose would create empty, a path outside the compose file's
   *  folder, a symlink leaving the checkout). Not mounted. */
  absent: string[];
}

/**
 * Copy a GIT stack's relative bind sources out of the build checkout into the
 * stack's own dir, so they outlive the build.
 *
 * A git stack is cloned into a build scratch dir that is deleted when the
 * build ends, so a bind like n8n's `./init-data.sh:/docker-entrypoint-initdb.d/
 * init-data.sh` had nothing durable to point at and was dropped: Postgres
 * initialised without the script, the role n8n logs in as was never created,
 * and n8n crash-looped on "password authentication failed".
 *
 * Only RELATIVE sources (`./x`) are the repo's; an absolute one is a host
 * path, which lib/host-binds.ts decides. A source is resolved through its real
 * path and must stay inside the compose file's folder, so a symlink committed
 * to the repo cannot make the copy (or the mount) read the host. Each source
 * replaces its previous copy, so a redeploy picks up the file's new contents.
 */
export async function stageRepoBindSources(
  sources: ReadonlyArray<string>,
  checkoutDir: string,
  stackDir: string,
): Promise<RepoBindStaging> {
  const staged = new Set<string>();
  const absent: string[] = [];
  const root = await realPathOf(checkoutDir);
  for (const source of new Set(sources)) {
    if (!source.startsWith(".")) continue;
    const from = root ? await resolveRepoSource(source, checkoutDir, root) : null;
    const to = resolveBindSource(source, stackDir);
    if (!from || !to) {
      absent.push(source);
      continue;
    }
    await rm(to, { recursive: true, force: true });
    await mkdir(dirname(to), { recursive: true });
    // verbatimSymlinks: a link INSIDE a copied folder stays the relative link
    // the repo committed; it resolves in the container's own filesystem.
    await cp(from, to, { recursive: true, verbatimSymlinks: true });
    staged.add(source);
  }
  return { staged, absent };
}

/** The real path of `path`, or null when nothing is there. */
async function realPathOf(path: string): Promise<string | null> {
  const real = await Result.tryPromise({ try: () => realpath(path), catch: (cause) => cause });
  return real.isOk() ? real.value : null;
}

/** A bind source's real path in the checkout, or null when it is missing or
 *  resolves (through `..` or a symlink) outside the compose file's folder. */
async function resolveRepoSource(
  source: string,
  checkoutDir: string,
  realRoot: string,
): Promise<string | null> {
  const joined = resolveBindSource(source, checkoutDir);
  const real = joined ? await realPathOf(joined) : null;
  if (!real) return null;
  return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
}

/**
 * Read + parse one `env_file` target (relative to `dir`) into a `{K:V}` map,
 * or null when there is no such file, or its path would escape the tree.
 * Blank/`#` lines ignored; matching surrounding quotes stripped.
 */
export async function readEnvFile(
  path: string,
  dir: string,
): Promise<Record<string, string> | null> {
  const abs = safeJoin(resolve(dir), path);
  if (!abs) return null;
  const text = await Result.tryPromise({
    try: () => readFile(abs, "utf8"),
    catch: (cause) => cause,
  });
  return text.isOk() ? parseEnvFileText(text.value) : null;
}

/** `KEY=value` lines → map. Later lines win, as in compose. */
function parseEnvFileText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}
