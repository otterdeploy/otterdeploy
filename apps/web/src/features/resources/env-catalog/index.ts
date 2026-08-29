import { ENV_SCHEMAS } from "@/features/templates/catalog/env-schemas";

/**
 * Image → known-env lookup for the variables editors' key autocomplete.
 * See ./types.ts for the honesty contract.
 */
import type { EnvIssue, EnvSuggestion, ImageEnvCatalogEntry } from "./types";

import { APP_ENV_CATALOG } from "./catalog-apps";
import { DATABASE_ENV_CATALOG } from "./catalog-databases";
import { suggestionsFromEnvSpec } from "./from-env-spec";

export type { EnvIssue, EnvSuggestion } from "./types";

/**
 * Template `.env.schema`s, projected into catalog entries. Listed LAST so a
 * schema wins over a hand-written entry for the same image: the schema is
 * gated against the compose file and the hand-written one is not.
 */
const SCHEMA_ENTRIES: ImageEnvCatalogEntry[] = Object.entries(ENV_SCHEMAS).map(
  ([templateId, schema]) => ({
    images: schema.images,
    verifiedAgainst: `templates/catalog/env-schemas/${templateId}.env.schema`,
    vars: suggestionsFromEnvSpec(schema.source),
  }),
);

const ENTRIES: ImageEnvCatalogEntry[] = [
  ...DATABASE_ENV_CATALOG,
  ...APP_ENV_CATALOG,
  ...SCHEMA_ENTRIES,
];

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

/** Suggestions for every image in a stack, deduped by key (first wins). */
export function envSuggestionsForImages(
  images: ReadonlyArray<string | null | undefined>,
): EnvSuggestion[] {
  const seen = new Set<string>();
  const out: EnvSuggestion[] = [];
  for (const image of images) {
    for (const s of envSuggestionsForImage(image)) {
      if (seen.has(s.key)) continue;
      seen.add(s.key);
      out.push(s);
    }
  }
  return out;
}

/**
 * The issue to show under a row, if its key is a known variable with a shape
 * check. Unknown keys and reference values are never flagged.
 */
export function issueFor(
  suggestions: ReadonlyArray<EnvSuggestion>,
  key: string,
  value: string,
): EnvIssue | null {
  const k = key.trim();
  if (k === "") return null;
  const match = suggestions.find((s) => s.key === k);
  return match?.validate?.(value) ?? null;
}
