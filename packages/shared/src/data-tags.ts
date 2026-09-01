/**
 * Tags on external data connections: "analytics", "customer-acme", "eu".
 *
 * Normalised ONCE, here, the same way on both sides. The connect form runs a
 * typed tag through this before it becomes a chip; the server runs the saved
 * list through it before it becomes a row. Two normalisers would let the form
 * accept what the server refuses, and the user would learn the rule from an
 * error instead of from the chip.
 *
 * Lowercase, so `Prod` and `prod` cannot be two tags. Whitespace folds to a
 * hyphen, so a tag is one token in a filter strip. A short alphabet, so a tag
 * reads the same in a chip, a URL and a log line.
 */
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

const TAG = /^[a-z0-9][a-z0-9._-]*$/;

/** One tag in canonical form, or null when nothing acceptable is in `raw`. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (tag === "" || tag.length > MAX_TAG_LENGTH || !TAG.test(tag)) return null;
  return tag;
}

export type NormalizedTags = { ok: true; tags: string[] } | { ok: false; reason: string };

/**
 * A whole list in canonical form: normalised, blanks dropped, duplicates
 * collapsed (first occurrence wins, so order is the user's), capped.
 *
 * A malformed tag is an error naming the tag, not a silent drop: the person
 * who typed `customer/acme` should be told the slash is the problem rather
 * than find the tag missing after save.
 */
export function normalizeTags(raw: readonly string[]): NormalizedTags {
  const tags: string[] = [];
  for (const entry of raw) {
    if (entry.trim() === "") continue;
    const tag = normalizeTag(entry);
    if (tag === null) {
      return {
        ok: false,
        reason: `"${entry.trim()}" is not a usable tag: letters, digits, dots, dashes and underscores, up to ${MAX_TAG_LENGTH} characters`,
      };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) {
    return { ok: false, reason: `at most ${MAX_TAGS} tags per connection` };
  }
  return { ok: true, tags };
}
