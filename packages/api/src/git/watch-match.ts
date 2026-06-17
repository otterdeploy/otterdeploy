/**
 * `watchPatterns` enforcement for git-push builds.
 *
 * A git-sourced service may carry `buildConfig.watchPatterns` — repo-root-
 * relative globs. A push only rebuilds that service when at least one changed
 * path matches a pattern. Unset/empty patterns = rebuild on every push.
 *
 * Fail-open: GitHub truncates the changed-file lists on large pushes (and
 * omits them entirely past a size cap). When we can't determine what changed,
 * we rebuild rather than risk silently skipping a real deploy.
 */

import type { PushEvent } from "./types";

/** Union of every added/removed/modified path across all commits in the push,
 *  deduped. Empty = GitHub gave us no file lists (large/truncated push). */
export function changedPathsFromPush(ev: PushEvent): string[] {
  const commits = [
    ...(ev.commits ?? []),
    ...(ev.head_commit ? [ev.head_commit] : []),
  ];
  const paths = new Set<string>();
  for (const c of commits) {
    for (const p of c.added ?? []) paths.add(p);
    for (const p of c.removed ?? []) paths.add(p);
    for (const p of c.modified ?? []) paths.add(p);
  }
  return [...paths];
}

/** Whether a service with these watch patterns should rebuild for a push that
 *  touched `changedPaths`. */
export function matchesWatchPatterns(
  changedPaths: string[],
  patterns: string[] | null | undefined,
): boolean {
  // No patterns configured → rebuild on every push (default behaviour).
  if (!patterns || patterns.length === 0) return true;
  // Patterns configured but we don't know what changed → fail open.
  if (changedPaths.length === 0) return true;

  const globs = patterns
    .filter((p) => p.trim().length > 0)
    .map((p) => new Bun.Glob(p));
  if (globs.length === 0) return true;

  return changedPaths.some((path) => globs.some((g) => g.match(path)));
}
