/**
 * Dockerfiles that `auto` did not pick up.
 *
 * `auto` builds with a Dockerfile only when one sits at the default path,
 * `<root directory>/Dockerfile`. A repo that keeps it at `docker/Dockerfile` or
 * `Dockerfile.prod` silently fell through to Railpack, which then failed on a
 * root with no project manifest, and nothing in the log pointed at the
 * Dockerfile that was right there.
 *
 * This only WARNS. Auto-selecting a nested Dockerfile would change what `auto`
 * means for every repo carrying an unrelated one (a database image under
 * `docker/db/`, a CI image), and the build context such a Dockerfile expects
 * (its own dir or the repo root) is not knowable from its location. Naming the
 * file and the exact setting that uses it is unambiguous and costs nothing.
 *
 * Read-only and bounded: a few levels deep, dependency/output and hidden dirs
 * skipped, a hard cap on directories visited, so a huge repo cannot stall
 * resolution.
 */

import { Result } from "better-result";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** `Dockerfile.prod`, `api.Dockerfile`, `dockerfile`: the common spellings. */
const DOCKERFILE_NAME = /^(?:dockerfile(?:\..+)?|.+\.dockerfile)$/i;

/** Dirs that hold installs or build output, never a hand-written Dockerfile. */
const SKIPPED_DIRS = new Set(["node_modules", "vendor", "dist", "build", "out", "target"]);

const MAX_DEPTH = 3;
const MAX_DIRS_VISITED = 500;
const MAX_LISTED = 3;

/**
 * Dockerfiles under `appDir` other than the default `Dockerfile` at its top,
 * as paths relative to `appDir`, shallowest first then alphabetical.
 */
export function findDockerfiles(appDir: string): string[] {
  const found: Array<{ path: string; depth: number }> = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_DIRS_VISITED) {
    const dir = queue.shift();
    if (!dir) break;
    visited += 1;
    const entries = Result.try(() => readdirSync(join(appDir, dir.rel), { withFileTypes: true }));
    if (entries.isErr()) continue;
    for (const entry of entries.value) {
      const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const skip = entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name);
        if (!skip && dir.depth < MAX_DEPTH) queue.push({ rel, depth: dir.depth + 1 });
      } else if (entry.isFile() && DOCKERFILE_NAME.test(entry.name) && rel !== "Dockerfile") {
        found.push({ path: rel, depth: dir.depth });
      }
    }
  }

  return found
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => f.path);
}

/**
 * The warning for an `auto` build falling back to Railpack while Dockerfiles
 * exist off the default path; empty when there are none.
 */
export function undetectedDockerfileWarnings(appDir: string, subdir: string | undefined): string[] {
  const found = findDockerfiles(appDir);
  const first = found[0];
  if (!first) return [];
  const where = subdir ? `the root directory "${subdir}"` : "the repository root";
  const listed = found.slice(0, MAX_LISTED).join(", ");
  const more = found.length > MAX_LISTED ? ` (and ${found.length - MAX_LISTED} more)` : "";
  return [
    `No Dockerfile at ${where}, but found ${listed}${more}; building with Railpack instead. ` +
      `To build with it, set the build method to Dockerfile and the Dockerfile path to "${first}"` +
      (subdir ? ` (relative to the root directory).` : `.`),
  ];
}
