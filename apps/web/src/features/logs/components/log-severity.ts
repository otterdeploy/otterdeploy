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
      /[✖✗]/,
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

export function classifyLogSeverity(line: string): LogSeverity {
  const s = line.trim();
  if (!s) return "normal";
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
