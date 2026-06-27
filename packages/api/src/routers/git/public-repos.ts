/**
 * Register a public Git URL as a gitRepo row. Used by the wizard +
 * Settings → Source so projects without a GitHub App installation can
 * still bind to a public repo and build from it.
 *
 * No webhook plumbing — public-URL bindings deploy on demand only;
 * pushes don't auto-trigger because we never registered a GitHub App
 * delivery. The builder pipeline skips the installation-token mint when
 * `gitRepo.installationId` is null.
 *
 * Public repos aren't tenant-scoped — the row is keyed by
 * `providerRepoId` (we synthesize `public:<normalized-url>`) so two
 * orgs pasting the same URL share a row. That's fine because the data
 * IS public; org isolation happens at the project binding level.
 */

import { db } from "@otterdeploy/db";
import { gitRepo } from "@otterdeploy/db/schema";
import { Result, TaggedError } from "better-result";

class InvalidCloneUrlError extends TaggedError("InvalidCloneUrlError")<{
  message: string;
}>() {
  constructor(message: string) {
    super({ message });
  }
}

export interface PublicRepoView {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
}

interface NormalizedRepo {
  cloneUrl: string;
  fullName: string;
  providerRepoId: string;
}

/**
 * Accept https:// URLs only — the most common case and the one that
 * works with the builder's existing token-injection-skipped path.
 * Strips a trailing `.git`, trims whitespace, lowercases the host.
 * Derives `owner/repo` from the path's first two segments.
 */
function normalizeCloneUrl(raw: string): Result<NormalizedRepo, InvalidCloneUrlError> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return Result.err(new InvalidCloneUrlError("Clone URL is empty"));
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return Result.err(new InvalidCloneUrlError("Clone URL is not a valid URL"));
  }
  if (parsed.protocol !== "https:") {
    return Result.err(
      new InvalidCloneUrlError(
        "Clone URL must use https:// — ssh:// + git@ URLs need credentials we don't store",
      ),
    );
  }
  // Drop any embedded credentials, fragments, queries.
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  // GitHub-style repo paths: `/owner/repo` or `/owner/repo.git`.
  const pathParts = parsed.pathname
    .split("/")
    .filter((p) => p.length > 0)
    .map((p) => (p.endsWith(".git") ? p.slice(0, -".git".length) : p));
  if (pathParts.length < 2) {
    return Result.err(
      new InvalidCloneUrlError(
        "Clone URL path must include both an owner and a repo (e.g. https://github.com/owner/repo.git)",
      ),
    );
  }
  const owner = pathParts[0];
  const repo = pathParts[1];
  const normalizedPath = `/${owner}/${repo}.git`;
  parsed.pathname = normalizedPath;
  const cloneUrl = parsed.toString();
  return Result.ok({
    cloneUrl,
    fullName: `${owner}/${repo}`,
    // Stable synthetic id so the unique index naturally dedupes. Two
    // operators pasting the same URL share one row.
    providerRepoId: `public:${parsed.host.toLowerCase()}/${owner}/${repo}`,
  });
}

/**
 * Upsert a public-URL gitRepo row. Returns the persisted view. Existing
 * row (same providerRepoId) is reused — but we still re-write fullName
 * / cloneUrl in case the operator pasted a different surface form.
 */
export async function connectPublicRepo(args: {
  cloneUrl: string;
}): Promise<Result<PublicRepoView, InvalidCloneUrlError>> {
  const normalized = normalizeCloneUrl(args.cloneUrl);
  if (normalized.isErr()) return Result.err(normalized.error);
  const { cloneUrl, fullName, providerRepoId } = normalized.value;

  const [row] = await db
    .insert(gitRepo)
    .values({
      installationId: null,
      providerRepoId,
      fullName,
      cloneUrl,
      // A repo linked by public clone URL is public by definition — we
      // reach it over anonymous HTTPS with no installation. Record that
      // explicitly; otherwise the column defaults to `true` and any code
      // reading isPrivate (e.g. the build trigger) wrongly treats a public
      // repo as private. The `public:` prefix on providerRepoId remains the
      // row-kind signal; this just keeps the flag truthful.
      isPrivate: false,
      // defaultBranch falls back to the column default ("main"). The
      // builder reads the actual ref from the deployment row, not from
      // here — this is just a display default for the UI dropdown.
    })
    .onConflictDoUpdate({
      target: gitRepo.providerRepoId,
      // Also corrects rows created before isPrivate was written here.
      set: { fullName, cloneUrl, isPrivate: false, updatedAt: new Date() },
    })
    .returning({
      id: gitRepo.id,
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      isPrivate: gitRepo.isPrivate,
      cloneUrl: gitRepo.cloneUrl,
    });

  if (!row) {
    return Result.err(new InvalidCloneUrlError("Failed to persist public repo row"));
  }
  return Result.ok(row);
}
