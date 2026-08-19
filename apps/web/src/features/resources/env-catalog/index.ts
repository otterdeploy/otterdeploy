/**
 * Image → known-env lookup for the variables editors' key autocomplete.
 * See ./types.ts for the honesty contract.
 */
import type { EnvSuggestion, ImageEnvCatalogEntry } from "./types";

import { APP_ENV_CATALOG } from "./catalog-apps";
import { DATABASE_ENV_CATALOG } from "./catalog-databases";

export type { EnvSuggestion } from "./types";

const ENTRIES: ImageEnvCatalogEntry[] = [...DATABASE_ENV_CATALOG, ...APP_ENV_CATALOG];

/**
 * Reduce an image ref to the catalog's repo key: drop digest and tag,
 * lowercase, and strip the implicit `docker.io/` + `library/` prefixes so
 * `postgres:17-alpine`, `library/postgres` and `docker.io/library/postgres@…`
 * all resolve to `postgres`.
 */
export function normalizeImageRepo(image: string): string {
  const noDigest = image.split("@")[0] ?? image;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  const repo = colon > slash ? noDigest.slice(0, colon) : noDigest;
  return repo
    .toLowerCase()
    .replace(/^docker\.io\//, "")
    .replace(/^library\//, "");
}

const BY_REPO = new Map<string, EnvSuggestion[]>();
for (const entry of ENTRIES) {
  for (const repo of entry.images) BY_REPO.set(repo, entry.vars);
}

/** Known env vars for an image ref; empty for images the catalog doesn't
 *  cover (the editor then behaves exactly as before — no fake suggestions). */
export function envSuggestionsForImage(image: string | null | undefined): EnvSuggestion[] {
  if (!image) return [];
  return BY_REPO.get(normalizeImageRepo(image)) ?? [];
}

/**
 * Filter + rank suggestions against what the operator typed: prefix matches
 * first, then substring matches, case-insensitive; keys already used in the
 * editor drop out. An empty query surfaces the full (unused) list so the
 * dropdown doubles as discovery.
 */
export function matchEnvSuggestions(
  suggestions: EnvSuggestion[],
  query: string,
  takenKeys: ReadonlySet<string>,
): EnvSuggestion[] {
  const q = query.trim().toUpperCase();
  const available = suggestions.filter((s) => !takenKeys.has(s.key));
  if (q === "") return available;
  const starts: EnvSuggestion[] = [];
  const contains: EnvSuggestion[] = [];
  for (const s of available) {
    const key = s.key.toUpperCase();
    if (key === q) continue; // fully typed: nothing left to suggest
    if (key.startsWith(q)) starts.push(s);
    else if (key.includes(q)) contains.push(s);
  }
  return [...starts, ...contains];
}
