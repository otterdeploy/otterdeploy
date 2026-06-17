/**
 * Small pure helpers shared by the compose create handler and the manifest
 * reconciler. Kept dependency-free so both call sites resolve the same stack
 * name / repo URL / secret-key heuristics.
 */

/** Credential-looking keys default to secret (mirrors the service wizard). */
export const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

const sanitize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Swarm namespace for a stack: `<projectSlug>-<stackName>`, capped to 60. */
export const stackNameFor = (projectSlug: string, name: string): string =>
  `${sanitize(projectSlug)}-${sanitize(name)}`.slice(0, 60);

/** Parse `github.com/owner/repo[.git]` (https or ssh-ish) → owner/repo + a
 *  normalized https clone url. Returns null for anything we can't clone. */
export function parseGitHubUrl(
  raw: string,
): { owner: string; repo: string; cloneUrl: string } | null {
  const m = raw
    .trim()
    .match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m?.[1] || !m[2]) return null;
  const owner = m[1];
  const repo = m[2];
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}
