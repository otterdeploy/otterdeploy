/** Turn a 2-letter ISO-3166 alpha-2 country code into its flag emoji (a pair of
 *  regional-indicator symbols). Returns "" for anything that isn't two ASCII
 *  letters, so callers can render it unconditionally. */
export function flagEmoji(cc: string): string {
  const code = cc.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6 - 65; // 'A' → regional indicator A
  return String.fromCodePoint(base + code.charCodeAt(0), base + code.charCodeAt(1));
}
