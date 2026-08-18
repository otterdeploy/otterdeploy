/**
 * One rendered log line: severity stripe, optional timestamp, and the message
 * with the tool's own ANSI colors (or the bare text when the reader turned
 * colors off). Shared by {@link LogViewer} and the update dialog's log pane.
 */

import { cn } from "@/shared/lib/utils";

import { AnsiLine, stripAnsi } from "./ansi";
import { classifyLogSeverity, SEVERITY_BAR, SEVERITY_TEXT } from "./log-severity";

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

export function LogLineRow({
  line,
  highlighted = false,
  severity: precomputed,
  showTimestamp = true,
  plain = false,
}: {
  line: LogLine;
  highlighted?: boolean;
  /** Pass the severity when the caller already classified this line (the
   *  viewer does, for its counts) so the row doesn't strip ANSI a second time
   *  for every line it paints. */
  severity?: ReturnType<typeof classifyLogSeverity>;
  showTimestamp?: boolean;
  /** Strip ANSI colors and render the bare text. */
  plain?: boolean;
}) {
  // Classify + search on ANSI-stripped text; render with the tool's own
  // colors via AnsiLine (a raw ESC byte is invisible in HTML, so untreated
  // lines would show literal `[32m✓[39m` garbage) unless the reader asked
  // for the plain text.
  const severity = precomputed ?? classifyLogSeverity(stripAnsi(line.line));
  return (
    <div
      data-log-id={line.id}
      className={cn(
        "flex scroll-my-8 items-stretch gap-2.5 rounded-sm",
        highlighted && "bg-foreground/10 ring-1 ring-foreground/15 ring-inset",
      )}
    >
      <span className={cn("w-[3px] shrink-0 rounded-full", SEVERITY_BAR[severity])} />
      <div className={cn("flex min-h-[1.35em] flex-1 gap-3", SEVERITY_TEXT[severity])}>
        {showTimestamp && line.ts && (
          <span className="shrink-0 text-muted-foreground/50">
            {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
          </span>
        )}
        <span className="break-all whitespace-pre-wrap">
          {plain ? stripAnsi(line.line) : <AnsiLine text={line.line} />}
        </span>
      </div>
    </div>
  );
}
