/**
 * Minimal ANSI/SGR handling for the LogViewer.
 *
 * Build tools (vite, bun, buildkit, git) emit color escape codes; the ESC byte
 * is invisible in HTML so untreated lines render as literal `[32m✓[39m`
 * garbage. Two surfaces:
 *
 *   - `stripAnsi` — plain text for search, severity classification, copy.
 *   - `AnsiLine`  — renders SGR color/emphasis as styled spans (the viewer is
 *     a terminal-style pane; the tool's own colors are signal, not noise).
 *
 * Only SGR (`ESC[…m`) is *rendered*; every other escape (cursor movement,
 * OSC titles, etc.) is dropped from display entirely.
 */

const ESC = "\x1b";

// CSI (ESC[ … final byte), OSC (ESC] … BEL / ESC\), and lone two-byte escapes.
// eslint-disable-next-line no-control-regex
const ANSI_ANY = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;]*)m/g;

export function stripAnsi(text: string): string {
  return text.includes(ESC) ? text.replace(ANSI_ANY, "") : text;
}

interface SgrState {
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface Segment extends SgrState {
  text: string;
}

// Standard + bright foreground palette, tuned for the viewer's near-black
// background — desaturated enough to sit inside the app's quiet monochrome.
const FG: Record<number, string> = {
  30: "#71717a",
  31: "#f87171",
  32: "#4ade80",
  33: "#facc15",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#22d3ee",
  37: "#d4d4d8",
  90: "#8b8b93",
  91: "#fca5a5",
  92: "#86efac",
  93: "#fde047",
  94: "#93c5fd",
  95: "#d8b4fe",
  96: "#67e8f9",
  97: "#fafafa",
};

const resetSgr = (s: SgrState): void => {
  delete s.color;
  s.bold = s.dim = s.italic = s.underline = false;
};

// Emphasis set/clear codes → state mutation. 21 is "bold off" in practice
// (double-underline in the spec, but no build tool means that).
const EMPHASIS: Record<number, (s: SgrState) => void> = {
  0: resetSgr,
  1: (s) => void (s.bold = true),
  2: (s) => void (s.dim = true),
  3: (s) => void (s.italic = true),
  4: (s) => void (s.underline = true),
  21: (s) => void (s.bold = s.dim = false),
  22: (s) => void (s.bold = s.dim = false),
  23: (s) => void (s.italic = false),
  24: (s) => void (s.underline = false),
};

/** Apply one SGR parameter list ("32", "1;31", "0", "") to the running state.
 *  256-color / truecolor selectors are parsed (so their params don't leak as
 *  codes) but rendered as the default color. Background codes are ignored. */
function applySgr(state: SgrState, params: string): void {
  const codes = (params === "" ? "0" : params).split(";").map((c) => Number(c || "0"));
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? 0;
    if (EMPHASIS[code]) EMPHASIS[code](state);
    else if (FG[code]) state.color = FG[code];
    else if (code === 39) delete state.color;
    else if (code === 38 || code === 48) {
      // Extended color: consume `5;n` or `2;r;g;b` so the params aren't
      // re-read as SGR codes. Foreground keeps the default color; bg ignored.
      i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      if (code === 38) delete state.color;
    }
    // 40–49 / 100–107 (backgrounds) and anything unknown: ignore.
  }
}

function parseAnsi(text: string): Segment[] {
  const segments: Segment[] = [];
  const state: SgrState = {};
  let last = 0;
  for (const m of text.matchAll(SGR)) {
    const chunk = text.slice(last, m.index);
    if (chunk) segments.push({ text: stripAnsi(chunk), ...state });
    applySgr(state, m[1] ?? "");
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail) segments.push({ text: stripAnsi(tail), ...state });
  return segments.filter((s) => s.text.length > 0);
}

/** One log line with its ANSI styling applied. Plain lines (no ESC byte) pass
 *  straight through as text — no per-line parse cost on clean output. */
export function AnsiLine({ text }: { text: string }) {
  if (!text.includes(ESC)) return text;
  return parseAnsi(text).map((seg, i) =>
    seg.color || seg.bold || seg.dim || seg.italic || seg.underline ? (
      <span
        // Segments are positional within an immutable line — index keys are safe.
        // eslint-disable-next-line react/no-array-index-key
        key={i}
        style={{
          color: seg.color,
          fontWeight: seg.bold ? 600 : undefined,
          fontStyle: seg.italic ? "italic" : undefined,
          textDecoration: seg.underline ? "underline" : undefined,
          opacity: seg.dim ? 0.6 : undefined,
        }}
      >
        {seg.text}
      </span>
    ) : (
      // eslint-disable-next-line react/no-array-index-key
      <span key={i}>{seg.text}</span>
    ),
  );
}
