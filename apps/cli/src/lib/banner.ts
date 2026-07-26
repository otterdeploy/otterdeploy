/**
 * The otterdeploy mark, rendered for a terminal.
 *
 * Box-drawing rounded corners plus a diagonal give the same slashed-zero
 * silhouette as the graphical mark (brand/logo/mark.svg) — the ring is the
 * product's `rounded-lg` node shape, the slash is the one accented element.
 * Kept to four rows so it reads as square in a cell grid roughly 1:2.
 *
 * Colour comes from the shared theme rather than a local escape code, so the
 * slash is the same single accent every other line uses. DESIGN.md specifies
 * one accent hue and the mark is not an exception to it — this file used to
 * hardcode a second blue (#3b82f6) that no other output could match.
 */

import { G } from "./ui/glyphs";
import { bold, dim, paint } from "./ui/theme";

/** Mark rows split at the accent, so only the diagonal gets coloured. */
const UNICODE_ROWS: Array<[string, string, string]> = [
  ["╭──────╮", "", ""],
  ["│    ", "╱", " │"],
  ["│  ", "╱", "   │"],
  ["╰──────╯", "", ""],
];

/** A non-UTF-8 locale would render the box-drawing set as mojibake. */
const ASCII_ROWS: Array<[string, string, string]> = [
  ["+------+", "", ""],
  ["|    ", "/", " |"],
  ["|  ", "/", "   |"],
  ["+------+", "", ""],
];

// Reuse the glyph layer's locale decision rather than re-probing the env.
const MARK_ROWS = G.vertical === "│" ? UNICODE_ROWS : ASCII_ROWS;

export interface BannerOptions {
  /** Rendered under the wordmark, e.g. the CLI version. */
  subtitle?: string;
}

export function renderBanner({ subtitle }: BannerOptions = {}): string {
  // Wordmark sits on the two middle rows so it optically centres on the mark.
  const right = ["", bold("otterdeploy"), dim(subtitle ?? ""), ""];

  return MARK_ROWS.map(([head, slash, tail], i) => {
    const text = right[i];
    const mark = `${dim(head)}${paint("accent", slash)}${dim(tail)}`;
    return `  ${mark}${text ? `   ${text}` : ""}`;
  })
    .join("\n")
    .replace(/\s+$/gm, "");
}
