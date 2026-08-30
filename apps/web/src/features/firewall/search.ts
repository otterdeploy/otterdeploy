/**
 * One search box for the whole Firewall view.
 *
 * Every panel used to be its own island: Enforcing Now had no filter at all,
 * so finding one IP among 69 rows of identically-scenario'd Cloudflare ranges
 * meant Ctrl+F on the browser. The other panels had windows but nothing that
 * answered "show me Germany" or "show me the SSH bans".
 *
 * The rule is deliberately one rule, applied to every table: split the query
 * on whitespace, lowercase it, and require EVERY term to appear somewhere in
 * the row's searchable text. That makes `de cloudflare`, `ssh`, `172.71` and
 * `cscli manual` all work without teaching anyone a syntax, and it means the
 * box behaves identically whichever tab it is sitting above.
 *
 * Filtering is client-side on purpose. Each panel already holds its whole
 * answer in memory (the reads are capped at a couple of hundred rows), so a
 * round trip per keystroke would buy nothing and cost the instant feedback
 * that makes a filter feel like a filter.
 */

/** Lowercased terms, in order. An empty query yields an empty list. */
export function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/**
 * A row's searchable text: every field worth matching, lowercased and joined.
 *
 * Nullish and empty parts drop out rather than becoming "null"/"undefined" in
 * the haystack, where they would make the term `null` match half the table.
 */
export function haystack(parts: ReadonlyArray<string | number | null | undefined>): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined || part === "") continue;
    kept.push(String(part).toLowerCase());
  }
  return kept.join(" ");
}

/** Every term present. No terms = no filter, so everything matches. */
export function matchesTerms(hay: string, terms: readonly string[]): boolean {
  return terms.every((term) => hay.includes(term));
}

/**
 * Filter rows by a raw query string, given a projection to each row's
 * searchable fields. Returns the same array identity when the query is empty,
 * so a non-searching panel never re-renders its table for nothing.
 */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => ReadonlyArray<string | number | null | undefined>,
): readonly T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return rows;
  return rows.filter((row) => matchesTerms(haystack(fields(row)), terms));
}
