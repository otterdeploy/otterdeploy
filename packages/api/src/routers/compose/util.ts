/**
 * Small pure helpers shared by the compose create handler and the manifest
 * reconciler. Kept dependency-free so both call sites resolve the same stack
 * name / repo URL / secret-key heuristics.
 */

import type { ComposeFile } from "@otterdeploy/shared/compose";

const COMPOSE_FILENAMES = [
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
];

/**
 * Pick the designated compose file out of a multi-file inline tree. Preference:
 * the explicit `composePath`, else a conventional filename at the tree root,
 * else the first file. Returns its content + path so `composeContent` /
 * `composePath` stay in sync with `files` (every existing reader parses
 * `composeContent`). Returns null when the tree has no usable compose file.
 */
export function pickComposeFile(
  files: ComposeFile[],
  composePath?: string | null,
): { content: string; path: string } | null {
  if (files.length === 0) return null;
  const want = composePath?.trim();
  if (want) {
    const hit = files.find((f) => f.path === want);
    if (hit) return { content: hit.content, path: hit.path };
  }
  const byName = files.find((f) => COMPOSE_FILENAMES.includes(f.path));
  if (byName) return { content: byName.content, path: byName.path };
  const first = files[0];
  return first ? { content: first.content, path: first.path } : null;
}

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
  const m = raw.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m?.[1] || !m[2]) return null;
  const owner = m[1];
  const repo = m[2];
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}
