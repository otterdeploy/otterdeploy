import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { LogLevel, LogLine } from "../data/use-project-log-stream";

// INFO uses --primary so the log palette stays aligned with every other
// interactive accent in the app. One token, one place to tweak.
export const LEVEL_TEXT: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-info",
  warn: "text-warning",
  error: "text-destructive",
};

export const LEVEL_STRIPE: Record<LogLevel, string> = {
  debug: "bg-muted-foreground/40",
  info: "bg-info",
  warn: "bg-warning",
  error: "bg-destructive",
};

interface LogRowProps {
  line: LogLine;
  expanded: boolean;
  wrap: boolean;
  onToggle: () => void;
}

export function LogRow({ line, expanded, wrap, onToggle }: LogRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "flex items-start border-b border-border/40 transition-colors",
        expanded ? "bg-muted/30" : "hover:bg-muted/15",
        "cursor-pointer",
      )}
    >
      <span
        className={cn("w-1 shrink-0 self-stretch", LEVEL_STRIPE[line.level])}
        aria-hidden
      />

      <span className="flex w-6 shrink-0 items-start justify-center pt-1.5 text-muted-foreground/60">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
      </span>

      <span className="w-28 shrink-0 px-1 py-1.5 text-[11.5px] text-muted-foreground">
        {line.ts}
      </span>
      <span
        className={cn(
          "w-14 shrink-0 px-1 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em]",
          LEVEL_TEXT[line.level],
        )}
      >
        {line.level}
      </span>
      <span className="w-20 shrink-0 truncate px-1 py-1.5 text-xs text-foreground/80">
        {line.svc}
      </span>
      <span
        className={cn(
          "flex-1 px-3 py-1.5 text-xs text-foreground",
          wrap ? "whitespace-pre-wrap wrap-break-word" : "truncate",
        )}
      >
        {line.msg}
        {expanded && (
          <div className="mt-2 rounded-sm border border-border/40 bg-card/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <MetaField label="stream" value={line.stream} />
            <MetaField label="resource" value={line.resourceId || "—"} mono />
            <MetaField label="timestamp" value={line.tsIso ?? "—"} mono />
          </div>
        )}
      </span>
    </div>
  );
}

function MetaField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted-foreground/60">{label}</span>
      <span className={cn("truncate text-foreground/80", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
