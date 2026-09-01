/**
 * The fleet's "needs attention" list: silent, stale and down boxes plus every
 * host's own recommendations, ranked. One line per item: the dot says how
 * bad, the sentence says what, the chip says where, the link opens the tab
 * that deals with it. The explanation lives on the server page, not here.
 */
import { Link } from "@tanstack/react-router";

import type { AttentionItem, AttentionSeverity } from "@/features/servers/detail/fleet-attention";

import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

const DOT: Record<AttentionSeverity, string> = {
  crit: "bg-destructive",
  warn: "bg-warning",
  info: "bg-info",
};

const LIMIT = 5;

export function FleetAttention({
  items,
  orgSlug,
}: {
  items: readonly AttentionItem[];
  orgSlug: string;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, LIMIT);
  const more = items.length - shown.length;
  return (
    <Card className="min-w-0 gap-0 overflow-hidden rounded-md p-0">
      <div className="flex flex-col divide-y">
        {shown.map((item) => (
          <Link
            key={item.id}
            to="/$orgSlug/servers/$serverId"
            params={{ orgSlug, serverId: item.serverId }}
            search={{ tab: item.tab }}
            className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-muted/50"
          >
            <span className={cn("size-2 shrink-0 rounded-full", DOT[item.severity])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {!item.title.startsWith(item.serverName) && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {item.serverName}
              </span>
            )}
            <span className="shrink-0 text-[12px] text-muted-foreground">→</span>
          </Link>
        ))}
      </div>
      {more > 0 && (
        <div className="border-t px-4 py-1.5 text-[11.5px] text-muted-foreground">
          and {more} more on the server pages
        </div>
      )}
    </Card>
  );
}
