/**
 * An error, set the way the log viewer sets a line: a thin level stripe on the
 * left, then the time and the text in muted mono. The stripe carries the
 * severity; the text stays readable rather than shouting in red, so the
 * status mark and word beside it remain the one red thing on the row.
 */

import { LEVEL_STRIPE } from "@/features/logs/data/use-project-log-stream";
import { cn } from "@/shared/lib/utils";

export function ErrorLogLine({
  text,
  ts,
  wrap = false,
  className,
}: {
  text: string;
  /** Clock shown before the text, as a log line has. */
  ts?: string;
  /** Wrap long text instead of truncating it to one line. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-stretch gap-2.5 font-mono text-[11.5px] leading-relaxed",
        className,
      )}
      title={wrap ? undefined : text}
    >
      <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", LEVEL_STRIPE.error)} />
      {ts ? <span className="shrink-0 text-muted-foreground/70">{ts}</span> : null}
      <span
        className={cn(
          "min-w-0 text-muted-foreground",
          wrap ? "break-all whitespace-pre-wrap" : "truncate whitespace-pre",
        )}
      >
        {text}
      </span>
    </div>
  );
}
