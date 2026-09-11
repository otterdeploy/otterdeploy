/**
 * A country code as a flag.
 *
 * Regional-indicator arithmetic rather than a lookup table: `US` is the two
 * code points 0x1F1FA 0x1F1F8, and every ISO-3166 alpha-2 code maps the same
 * way, so there is nothing to keep up to date and no country that is missing
 * because someone forgot it.
 *
 * The flag never travels alone — every caller shows the CODE beside it. A flag
 * is a 16px glyph that renders as two letters on Windows and not at all in some
 * terminals, so it is a fast second reading of the code, never the only one.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = "A".charCodeAt(0);

/** True for exactly two ASCII letters — the shape of an alpha-2 code. */
function isAlpha2(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code);
}

/**
 * The flag emoji for an ISO-3166 alpha-2 code, or null when it is not one.
 *
 * Null rather than a placeholder: a caller that cannot render a flag should
 * show the code by itself, not a box or a question mark standing in for one.
 */
export function countryFlag(code: string | null | undefined): string | null {
  if (!code || !isAlpha2(code)) return null;
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (upper.charCodeAt(0) - LETTER_A),
    REGIONAL_INDICATOR_A + (upper.charCodeAt(1) - LETTER_A),
  );
}
