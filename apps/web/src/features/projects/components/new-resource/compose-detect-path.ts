/**
 * Pure path checks behind the Compose-file field's `onChangeAsync` validator.
 *
 * Auto-detection only ever helps the operator who leaves the field blank. The
 * one who *types* a path is the one most able to get it subtly wrong.
 * `docker-compose.yaml` when the repo has `docker-compose.yml`, and until this
 * existed, that typo was indistinguishable from a correct entry right up until
 * the build failed looking for it. Same class of bug as the placeholder that
 * promised a detection it never ran; a different half of the field.
 *
 * Kept React-free and network-free so the rules are testable on their own: the
 * validator does the fetching, these functions do the deciding.
 */

import { detectComposeFilename } from "@otterdeploy/shared/compose";

/** A directory listing entry, matching `git.inspectRepo`'s output shape. */
export interface RepoEntry {
  name: string;
  type: "dir" | "file";
}

/** Strip leading/trailing slashes so "/a/" and "a" address the same place. */
export function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

/**
 * Split a repo-relative path into the directory to list and the filename to
 * look for. "deploy/compose.yml" → { dir: "deploy", base: "compose.yml" }.
 */
export function splitRepoPath(path: string): { dir: string; base: string } {
  const clean = trimSlashes(path.trim());
  const cut = clean.lastIndexOf("/");
  return cut === -1
    ? { dir: "", base: clean }
    : { dir: clean.slice(0, cut), base: clean.slice(cut + 1) };
}

/** Join a service subdirectory with a path inside it, tolerating empty parts. */
export function joinRepoPath(subdir: string, rest: string): string {
  const parts = [trimSlashes(subdir), trimSlashes(rest)].filter(Boolean);
  return parts.join("/");
}

/**
 * Reasons a typed path is rejected before any network call. An absolute path
 * or one climbing out of the repo can't be resolved against a git tree, and
 * the server would reject it later anyway.
 */
export function staticPathIssue(typed: string): string | undefined {
  const value = typed.trim();
  if (!value) return undefined;
  if (value.startsWith("/")) return "Enter a path relative to the repository, without a leading /.";
  if (value.split("/").includes("..")) return "The path must stay inside the repository.";
  if (trimSlashes(value).endsWith("/")) return "Enter a file path, not a directory.";
  return undefined;
}

/**
 * Check a typed filename against the directory listing it should live in.
 *
 * The suggestion is the point: a listing that lacks `docker-compose.yaml` but
 * holds `docker-compose.yml` should say so, because that near-miss is the
 * likeliest way to get here.
 */
export function listingPathIssue(base: string, entries: RepoEntry[]): string | undefined {
  const hit = entries.find((e) => e.name === base);
  if (hit?.type === "file") return undefined;
  if (hit) return `"${base}" is a directory, not a file.`;

  const suggestion = detectComposeFilename(
    entries.filter((e) => e.type === "file").map((e) => e.name),
  );
  return suggestion
    ? `No "${base}" here. Did you mean "${suggestion}"?`
    : `No "${base}" in this directory.`;
}
