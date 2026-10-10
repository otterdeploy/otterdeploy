/**
 * A record's measured state, in the same mono uppercase pill as the domain's
 * own VERIFIED / PENDING / NOT SET badge, so the page has one status
 * vocabulary.
 */

import { cn } from "@/shared/lib/utils";

import type { StatusTone } from "../lib/base-domain-copy";

const TONE: Record<StatusTone, string> = {
  ok: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  bad: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border/60",
};

export function DnsStatusPill({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
