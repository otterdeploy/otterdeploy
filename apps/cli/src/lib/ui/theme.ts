/**
 * Colour capability detection and the CLI's semantic palette.
 *
 * The palette is DESIGN.md's token set, dark-biased: terminals skew dark, so
 * every role resolves to the `*-dark` variant that was already tuned for a
 * dark surface. The light-mode hexes would fail contrast on a black cell grid.
 *
 * Three depths are supported because a palette that only works in truecolor
 * silently renders as garbage over ssh into an older `TERM`:
 *   - `truecolor`: 24-bit `38;2;r;g;b`, what modern terminals report
 *   - `ansi256`: nearest xterm-256 index, for `TERM=*-256color`
 *   - `ansi16`: bright-cut SGR, the universal floor
 *   - `none`, no escapes at all (NO_COLOR, --no-color, or a pipe)
 *
 * Colour is a *redundant* channel throughout: every state that gets a hue also
 * gets a distinct glyph (see glyphs.ts), so `NO_COLOR` output loses no meaning.
 * That is the WCAG "not by colour alone" rule applied to a terminal, and it is
 * why nothing in this CLI encodes state in colour only.
 */

// oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary
const env = process.env;

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

/** Semantic roles. Commands name a role, never a colour. */
export type Role =
  | "accent"
  | "ok"
  | "warn"
  | "danger"
  | "muted"
  | "ink"
  /** Machine identity: ids, hashes, digests. DESIGN.md's mono register. */
  | "id";

type Depth = "none" | "ansi16" | "ansi256" | "truecolor";

/** `[hex, xterm-256 index, ansi-16 SGR]` per role. */
const PALETTE: Record<Role, [string, number, number]> = {
  // info-dark #60a5fa: the one accent. Kept under DESIGN.md's ≤10% budget by
  // reserving it for identity and interactive affordances, never decoration.
  accent: ["#60a5fa", 75, 94],
  ok: ["#4ade80", 78, 92], // success-dark
  warn: ["#fbbf24", 214, 93], // warning-dark
  danger: ["#f87171", 210, 91], // destructive-dark
  muted: ["#7a7a74", 244, 90], // muted-ink, warm neutral rather than a cold grey
  ink: ["#f5f5f0", 255, 97], // ink-inverse
  id: ["#60a5fa", 75, 94],
};

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Resolved once at import. A CLI process never migrates between terminals, and
 * re-probing per line would show up on large tables.
 */
function detectDepth(): Depth {
  // https://no-color.org: any non-empty value disables colour. `--no-color`
  // is implemented by setting this var before first output (see ../color.ts).
  if (env.NO_COLOR) return "none";

  // FORCE_COLOR decides *whether* to colour (so CI can capture coloured logs
  // without a TTY); TERM/COLORTERM still decide *how deep*. Conflating the two
  // would emit 24-bit escapes into a 16-colour terminal that had asked for
  // colour explicitly.
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  if (!forced) {
    if (!process.stdout.isTTY) return "none";
    if (env.TERM === "dumb") return "none";
  }

  const colorterm = env.COLORTERM ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  const term = env.TERM ?? "";
  if (term.includes("256")) return "ansi256";
  // A TERM we don't recognise as deep is still a stated capability, so it wins
  // over FORCE_COLOR's optimism. Only a completely absent TERM falls back to
  // assuming a modern terminal (and only when colour was forced).
  if (term === "") return forced ? "truecolor" : "none";
  return "ansi16";
}

let depth: Depth = detectDepth();

/** Re-read the environment. Only for tests, which mutate `process.env`. */
export function refreshTheme(): void {
  depth = detectDepth();
}

export function colorEnabled(): boolean {
  return depth !== "none";
}

function open(role: Role): string {
  const [hex, index, basic] = PALETTE[role];
  switch (depth) {
    case "truecolor": {
      const [r, g, b] = hexToRgb(hex);
      return `${ESC}38;2;${r};${g};${b}m`;
    }
    case "ansi256":
      return `${ESC}38;5;${index}m`;
    case "ansi16":
      return `${ESC}${basic}m`;
    default:
      return "";
  }
}

/** Wrap `text` in a role's colour. A no-op when colour is off. */
export function paint(role: Role, text: string): string {
  if (depth === "none" || text === "") return text;
  return `${open(role)}${text}${RESET}`;
}

export function bold(text: string): string {
  if (depth === "none" || text === "") return text;
  return `${ESC}1m${text}${RESET}`;
}

export function dim(text: string): string {
  if (depth === "none" || text === "") return text;
  return `${ESC}2m${text}${RESET}`;
}

/** Bold + coloured, for the one-glyph state markers that lead a row. */
export function strong(role: Role, text: string): string {
  if (depth === "none" || text === "") return text;
  return `${ESC}1m${open(role)}${text}${RESET}`;
}

// oxlint-disable-next-line no-control-regex -- matching the SGR escape byte is the point
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/**
 * Printable width of a string, ignoring SGR escapes.
 *
 * Every column-aligning helper measures with this rather than `String.length`,
 * because a painted cell carries ~10 invisible bytes and `padEnd` on the raw
 * string would shear the column. Wide East-Asian glyphs are not accounted for,
 * no CLI output path emits them, and the glyph set is deliberately BMP
 * symbols that render single-width.
 */
export function width(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

/** Pad to `target` printable columns, ANSI-safe. */
export function padEnd(text: string, target: number): string {
  const pad = target - width(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

/** Right-align to `target` printable columns, ANSI-safe. */
export function padStart(text: string, target: number): string {
  const pad = target - width(text);
  return pad > 0 ? " ".repeat(pad) + text : text;
}
