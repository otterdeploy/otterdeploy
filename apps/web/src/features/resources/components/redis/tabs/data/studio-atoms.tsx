/**
 * Shared atoms + pure helpers for the Redis data studio — the type badge,
 * empty / skeleton states, TTL + JSON formatting, the SCAN-page merge, and the
 * oRPC error reader. Imported by the studio parts and the tab body.
 */

import { Database01Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export interface KeyRow {
  name: string;
  type: string;
  ttl: number;
}

export const VALUE_LIMIT = 500;

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} className="size-2.5" />
      {type}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon
            icon={Database01Icon}
            strokeWidth={2}
            className="size-5 text-muted-foreground"
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {body ? <EmptyDescription>{body}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

/** Append a SCAN page, dropping keys already in the list (cursors can repeat). */
export function mergeKeys(prev: KeyRow[], next: KeyRow[]): KeyRow[] {
  const seen = new Set(prev.map((k) => k.name));
  return [...prev, ...next.filter((k) => !seen.has(k.name))];
}

/** Compact TTL: `45s`, `12m`, `3h`, `5d`. (-1/-2 are filtered by callers.) */
export function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Pretty-print a string value if it parses as JSON; otherwise return as-is. */
export function prettyMaybeJson(s: string): string {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return s;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return s;
  }
}

/** Pull the human reason out of an oRPC error (QUERY_FAILED carries `data.reason`). */
export function errMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}
