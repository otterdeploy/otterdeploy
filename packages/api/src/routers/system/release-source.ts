/**
 * Release source — resolves the latest published otterdeploy version.
 *
 * Default source is the GitHub Releases API (`releases/latest`), which hands us
 * a semver tag, the changelog body, and a URL in one call — so the UI can show
 * "what's new" for free. Overridable via OTTERDEPLOY_UPDATE_MANIFEST_URL to a
 * fixture/mirror (testing, air-gapped). All failures are non-fatal: a network
 * error or garbage payload resolves to `null`, which the caller reads as "no
 * update available" rather than surfacing an error (Dokploy's posture).
 */
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import * as z from "zod";

export interface LatestRelease {
  /** Version tag, e.g. "v0.5.0". */
  version: string;
  /** Release notes (markdown), or null. */
  notes: string | null;
  /** Human-facing URL for the release, or null. */
  url: string | null;
}

// GitHub `releases/latest` payload — we only read three fields; `.loose()`
// (passthrough) so the rest of GitHub's large object doesn't fail validation.
const githubReleaseSchema = z.looseObject({
  tag_name: z.string().min(1),
  html_url: z.string().nullish(),
  body: z.string().nullish(),
});

function manifestUrl(): string {
  return (
    env.OTTERDEPLOY_UPDATE_MANIFEST_URL ??
    `https://api.github.com/repos/${env.OTTERDEPLOY_UPDATE_REPO}/releases/latest`
  );
}

/** Fetch + parse the latest release. Returns null on any failure (network,
 *  non-2xx, or a payload that doesn't match), so callers can treat "couldn't
 *  determine latest" identically to "already current". */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const res = await Result.tryPromise({
    try: async () => {
      const response = await fetch(manifestUrl(), {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "otterdeploy-updater",
        },
      });
      if (!response.ok) throw new Error(`release source responded ${response.status}`);
      return githubReleaseSchema.parse(await response.json());
    },
    catch: (cause) => cause,
  });
  if (res.isErr()) return null;
  return {
    version: res.value.tag_name,
    notes: res.value.body ?? null,
    url: res.value.html_url ?? null,
  };
}
