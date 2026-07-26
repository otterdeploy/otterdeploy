/**
 * The CLI's presentation layer — the one place terminal output is decided.
 *
 * Commands import from here and nowhere else for output:
 *
 * ```ts
 * import { abort, detail, ok, section, stateLabel, table, ui } from "../lib/ui";
 * ```
 *
 * Layering, so it stays coherent as commands are added:
 *   theme.ts    colour depth detection, DESIGN.md palette, ANSI-safe padding
 *   glyphs.ts   the glyph set and every state → (glyph, colour) mapping
 *   stream.ts   stdout for results, stderr for diagnostics
 *   render.ts   sections, tables, detail blocks, trees, rows
 *   message.ts  outcomes, failures, warnings, hints, prompts
 *
 * Two invariants worth preserving:
 *   - No command computes a colour or a column width. Ask for a role or a
 *     table; the layer decides how it looks.
 *   - Colour is always redundant with a glyph, so `NO_COLOR` and pipes lose
 *     no information.
 */

export { G, kindBadge, stateGlyph, stateLabel, stateOf } from "./glyphs";
export {
  abort,
  ask,
  confirm,
  fail,
  hint,
  hintCmd,
  note,
  ok,
  secret,
  select,
  warn,
} from "./message";
export type { Column, TreeNode } from "./render";
export { derivedFrom, detail, line, panel, row, section, table, tree } from "./render";
export { err, interactive, out } from "./stream";
export type { Role } from "./theme";
export {
  bold,
  colorEnabled,
  dim,
  padEnd,
  padStart,
  paint,
  refreshTheme,
  strong,
  width,
} from "./theme";
