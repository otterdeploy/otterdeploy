/**
 * Tar a local project directory into a gzipped source archive for a
 * `source: "upload"` deploy. Shells out to `tar` (present on macOS, Linux, and
 * Windows 10+ via bsdtar) rather than pulling a tar library into the bundle.
 *
 * Ignore semantics (per the plan): always drop `.git` and `node_modules`, and
 * layer on any `.gitignore` / `.dockerignore` / `.otterignore` present at the
 * project root via `--exclude-from`. Note: `tar`'s exclude patterns are a close
 * but not exact match for gitignore syntax (negations aren't honored). Good
 * enough for the common case; a `.otterignore` gives an explicit escape hatch.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALWAYS_EXCLUDE = [".git", "node_modules"];
const IGNORE_FILES = [".gitignore", ".dockerignore", ".otterignore"];

/**
 * macOS's bsdtar writes every file that carries an extended attribute (and
 * nearly all do: `com.apple.provenance`) twice: the file, and an AppleDouble
 * `._<name>` copy holding the attributes. On the Linux builder those are real
 * files in the build context: `._app.csproj` matched Railpack's `*.csproj`, so
 * a .NET 9 project parsed as garbage XML and built with the default .NET 8
 * SDK. COPYFILE_DISABLE=1 stops bsdtar writing them; other tars ignore it.
 */
export function tarEnv(): NodeJS.ProcessEnv {
  // oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary
  return { ...process.env, COPYFILE_DISABLE: "1" };
}

/** Build a gzipped tarball of `projectDir` and return its temp path. Throws on
 *  a `tar` failure (missing binary, unreadable dir). */
export function createSourceTarball(projectDir: string, stamp: string): string {
  const out = join(tmpdir(), `otterdeploy-source-${stamp}.tar.gz`);

  const excludeArgs = ALWAYS_EXCLUDE.flatMap((p) => ["--exclude", p]);
  const ignoreArgs = IGNORE_FILES.filter((f) => existsSync(join(projectDir, f))).flatMap((f) => [
    "--exclude-from",
    join(projectDir, f),
  ]);

  // Excludes must precede the path list. `-C projectDir .` archives the tree
  // with paths relative to the root (no leading project-dir component).
  const args = ["-czf", out, "-C", projectDir, ...excludeArgs, ...ignoreArgs, "."];
  const proc = spawnSync("tar", args, { encoding: "utf8", env: tarEnv() });
  if (proc.error) {
    throw new Error(`could not run tar (${proc.error.message}): is tar installed?`);
  }
  if (proc.status !== 0) {
    throw new Error(
      `tar failed (exit ${proc.status}): ${(proc.stderr || "").trim().slice(0, 500)}`,
    );
  }
  return out;
}
