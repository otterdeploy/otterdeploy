import type { RepoBinding, TreeSnapshot } from "./inspect-github";

/**
 * How repo inspection reads a PUBLIC repo with git instead of GitHub's REST
 * API (see ../../git/git-snapshot.ts for why). Both answers are null when the
 * binding is not a public one (private repos are read through the API with
 * their installation token, git has no credentials for them) or when git could
 * not reach the repo: the caller then falls back to the API.
 */
import {
  type FileRead,
  gitReadFile,
  gitTreeEntries,
  publicGithubCloneUrl,
} from "../../git/git-snapshot";

function publicGitUrl(binding: RepoBinding): string | null {
  return binding.installationGithubId ? null : publicGithubCloneUrl(binding.owner, binding.repo);
}

/** The repo's tree as a snapshot, or null. */
export async function gitTree(
  binding: RepoBinding,
  expiresAt: number,
): Promise<TreeSnapshot | null> {
  const url = publicGitUrl(binding);
  const entries = url ? await gitTreeEntries(url, binding.defaultBranch) : null;
  if (!entries) return null;
  const pathTypes = new Map<string, "dir" | "file">();
  for (const e of entries) pathTypes.set(e.path, e.type);
  return {
    paths: entries.map((e) => e.path).sort((a, b) => a.localeCompare(b)),
    pathTypes,
    expiresAt,
  };
}

/** A file's text, or "missing" (git looked and it is not there), or null when
 *  git could not look. */
export async function gitFile(
  binding: RepoBinding,
  path: string,
): Promise<Exclude<FileRead, { status: "unavailable" }> | null> {
  const url = publicGitUrl(binding);
  if (!url) return null;
  const read = await gitReadFile(url, binding.defaultBranch, path);
  return read.status === "unavailable" ? null : read;
}
