/**
 * Release source: resolves the latest published otterdeploy version for the
 * instance's update channel (docs/designs/release-channels.md, od-tfs2).
 *
 * - stable  → GitHub `releases/latest`, which by definition excludes
 *   prereleases, so nightly tags are structurally invisible to it.
 * - nightly → the releases LIST (newest first), taking the first entry whose
 *   tag parses as a version — prerelease OR stable. That "or stable" is the
 *   catch-up point: when v0.16.0 ships it outranks every v0.16.0-nightly.*,
 *   so nightly users are offered the stable of the same core.
 *
 * Overridable via OTTERDEPLOY_UPDATE_MANIFEST_URL to a fixture/mirror
 * (testing, air-gapped): the override wins on BOTH channels and must serve a
 * single releases/latest-shaped object. All failures are non-fatal: a network
 * error or garbage payload resolves to `null`, which the caller reads as "no
 * update available" rather than surfacing an error.
 */
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import * as z from "zod";

import { parseVersion } from "./compare";

const UPDATE_CHANNELS = ["stable", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

const updateChannelSchema = z.enum(UPDATE_CHANNELS);

/** Normalize a stored channel value; anything unrecognized means stable. */
export function parseUpdateChannel(value: string | null | undefined): UpdateChannel {
  const parsed = updateChannelSchema.safeParse(value);
  return parsed.success ? parsed.data : "stable";
}

export interface LatestRelease {
  /** Version tag, e.g. "v0.5.0" or "v0.16.0-nightly.20260820". */
  version: string;
  /** Release notes (markdown), or null. */
  notes: string | null;
  /** Human-facing URL for the release, or null. */
  url: string | null;
}

// GitHub release payload: we only read three fields; `.loose()` (passthrough)
// so the rest of GitHub's large object doesn't fail validation.
const githubReleaseSchema = z.looseObject({
  tag_name: z.string().min(1),
  html_url: z.string().nullish(),
  body: z.string().nullish(),
});

const githubReleaseListSchema = z.array(githubReleaseSchema);

const releasesBase = () => `https://api.github.com/repos/${env.OTTERDEPLOY_UPDATE_REPO}/releases`;

async function fetchGithubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "otterdeploy-updater",
    },
  });
  if (!response.ok) throw new Error(`release source responded ${response.status}`);
  return response.json();
}

function toLatestRelease(release: z.infer<typeof githubReleaseSchema>): LatestRelease {
  return {
    version: release.tag_name,
    notes: release.body ?? null,
    url: release.html_url ?? null,
  };
}

/** Stable (and the manifest override): one releases/latest-shaped object. */
async function fetchSingle(url: string): Promise<LatestRelease> {
  return toLatestRelease(githubReleaseSchema.parse(await fetchGithubJson(url)));
}

/** Nightly: the releases list is newest-first; take the first entry with a
 *  parseable version tag (prerelease or stable — see module doc). Drafts are
 *  not returned to unauthenticated callers, so no draft filter is needed. */
async function fetchNightly(): Promise<LatestRelease | null> {
  const releases = githubReleaseListSchema.parse(
    await fetchGithubJson(`${releasesBase()}?per_page=15`),
  );
  const hit = releases.find((release) => parseVersion(release.tag_name) !== null);
  return hit ? toLatestRelease(hit) : null;
}

/** Fetch + parse the channel's latest release. Returns null on any failure
 *  (network, non-2xx, or a payload that doesn't match), so callers can treat
 *  "couldn't determine latest" identically to "already current". */
export async function fetchLatestRelease(
  channel: UpdateChannel = "stable",
): Promise<LatestRelease | null> {
  const res = await Result.tryPromise({
    try: async () => {
      const override = env.OTTERDEPLOY_UPDATE_MANIFEST_URL;
      if (override) return fetchSingle(override);
      if (channel === "nightly") return fetchNightly();
      return fetchSingle(`${releasesBase()}/latest`);
    },
    catch: (cause) => cause,
  });
  return res.isOk() ? res.value : null;
}
