/**
 * Content-based log severity classification + the palettes the LogViewer uses
 * to colour each line's text and its left rail. Kept separate from the viewer
 * so the heuristic is easy to reuse and read on its own.
 *
 * Severity is derived from the line's *content*, not its stream — build tools
 * (git, docker/buildkit, vite, bun) write ordinary progress to stderr, so the
 * stream is a useless error signal. We look for the markers those tools
 * actually print: `error:`/`ERROR`/`✖` (+ stack frames so a whole trace reads
 * as one red block), `warning`/`(!)`/`[plugin …]`, `✓`/`built in` for success,
 * and a leading `info:`/`[info]`. Everything else is plain output.
 */

export type LogSeverity = "error" | "warn" | "success" | "info" | "normal";

// Ordered most-severe first: the first bucket whose patterns match wins, so
// `did not complete successfully` lands as an error before the success check.
const SEVERITY_PATTERNS: ReadonlyArray<readonly [Exclude<LogSeverity, "normal">, RegExp[]]> = [
  [
    "error",
    [
      /(^|[^a-z])(error|fatal|panic|failed|failure|exception|traceback)([^a-z]|$)/i,
      /\b[A-Z]\w*Error\b/, // TypeError, ReferenceError, …
      /[✖✗⨯]/, // incl. U+2A2F — Next.js prefixes runtime errors with it
      /^at\s+\S/, // stack frame — keeps a whole trace one contiguous red block
      /^\.\.\.\s*\d+\s*lines? matching/i,
      /^cause:/i,
      /exit code:\s*[1-9]/i,
      /\bdid not complete successfully\b/i,
    ],
  ],
  ["success", [/[✓✔]/, /\bbuilt in\b/i, /\bready in\b/i, /\bcompiled successfully\b/i]],
  ["warn", [/(^|[^a-z])(warn|warning|deprecated)([^a-z]|$)/i, /^\(!\)/, /\[plugin\b/i]],
  ["info", [/^\[?(info|notice)\]?[:\s-]/i]],
];

// A stack-trace frame — `    at fn (file:line:col)`. Leading whitespace is
// kept because grouping runs on the ANSI-stripped (un-trimmed) line.
const STACK_FRAME = /^\s*at\s+\S/;

// Net `{` minus `}` on a line — how the current object dump's depth changes.
// Good enough for log dumps; we don't try to skip braces inside string values.
function netBraces(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

/**
 * Collapse a multi-line thrown error — its header, stack frames, and the
 * `{ … }` object dump most runtimes print (cause, digest, code, …) — into a
 * single logical event. Returns a per-line flag (index-aligned to `lines`)
 * marking the *head* of each event, so callers count incidents instead of
 * lines and "next error" steps between traces rather than stack frames.
 *
 * A line continues the current event when we're already in one and it's either
 * a stack frame or sits inside an open brace; anything else ends it. So one
 * trace counts once, while two separate headers still count separately.
 */
export function markEventHeads(
  lines: ReadonlyArray<{ severity: LogSeverity; text: string }>,
): boolean[] {
  const heads: boolean[] = new Array(lines.length).fill(false);
  let inEvent = false;
  let depth = 0; // open braces of the current object dump

  for (let i = 0; i < lines.length; i++) {
    const { severity, text } = lines[i];
    if (inEvent && (depth > 0 || STACK_FRAME.test(text))) {
      depth = Math.max(0, depth + netBraces(text));
      continue; // body line — belongs to the open event, not a head
    }
    if (severity === "error" || severity === "warn") {
      heads[i] = true;
      inEvent = true;
      depth = Math.max(0, netBraces(text));
    } else {
      inEvent = false;
      depth = 0;
    }
  }
  return heads;
}

/**
 * Structured (JSON) logs — pino, bunyan, authentik, … — carry severity in a
 * `level` field the keyword heuristic can't see (and scanning the raw JSON for
 * words like "error" false-positives on field names). Read the level directly,
 * supporting both string levels ("error", "warning") and pino's numeric scale
 * (≥50 error, 40 warn, 30 info, ≤20 debug/trace). Returns null when the line
 * isn't a JSON object or has no recognisable level, so the caller falls back to
 * the content heuristic.
 */
function severityFromStructuredLevel(s: string): LogSeverity | null {
  if (s[0] !== "{") return null;
  const m = s.match(/"level"\s*:\s*(?:"([a-z]+)"|(\d{1,3}))/i);
  if (!m) return null;
  if (m[1]) {
    const lvl = m[1].toLowerCase();
    if (/^(fatal|critical|crit|panic|error|err)$/.test(lvl)) return "error";
    if (/^(warn|warning)$/.test(lvl)) return "warn";
    if (/^(info|notice)$/.test(lvl)) return "info";
    if (/^(debug|trace|verbose)$/.test(lvl)) return "normal";
    return null;
  }
  const n = Number(m[2]);
  if (n >= 50) return "error";
  if (n >= 40) return "warn";
  if (n >= 30) return "info";
  return "normal";
}

export function classifyLogSeverity(line: string): LogSeverity {
  const s = line.trim();
  if (!s) return "normal";
  // A `$ …` line is the builder echoing the command it's about to run, not tool
  // output — never treat it as an error. Otherwise a flag literal that merely
  // *contains* an error word (e.g. `railpack prepare … --error-missing-start`)
  // trips the error bucket and paints a perfectly healthy command line red.
  if (s.startsWith("$ ")) return "info";
  // Structured logs declare their own severity — authoritative when present.
  const structured = severityFromStructuredLevel(s);
  if (structured !== null) return structured;
  for (const [severity, patterns] of SEVERITY_PATTERNS) {
    if (patterns.some((re) => re.test(s))) return severity;
  }
  return "normal";
}

export const SEVERITY_TEXT: Record<LogSeverity, string> = {
  error: "text-destructive",
  warn: "text-warning",
  success: "text-success",
  info: "text-info",
  normal: "text-foreground/85",
};

// The rounded left rail is the severity indicator — a colored pill for
// error/warn/info/success, a faint hairline for ordinary output so every
// line still sits on a consistent rail (matches the table-row pattern).
export const SEVERITY_BAR: Record<LogSeverity, string> = {
  error: "bg-destructive",
  warn: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  normal: "bg-muted-foreground/20",
};
