/**
 * Activity tab for the bottom stack drawer — a live, project-scoped audit
 * feed (audit.listForProject). Newest first, 50 at a time with load-more
 * (capped at the API's 200; the org Audit page owns full history), refreshed
 * every 15s. Row idioms follow the org audit table: action in mono with a
 * verb-tone dot, actor, target ref, outcome tint, relative time.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  actionTone,
  timeAgo,
  type ActionTone,
} from "@/routes/_app/$orgSlug/-components/audit-helpers";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

const PAGE_SIZE = 50;
const MAX_LIMIT = 200;

type ProjectAudit = Awaited<ReturnType<typeof orpc.audit.listForProject.call>>;
type ProjectAuditEvent = ProjectAudit["items"][number];

/** Verb-family dot colors — semantic vocabulary only (no new hues). */
const TONE_DOT: Record<ActionTone, string> = {
  create: "bg-info",
  destroy: "bg-destructive",
  update: "bg-muted-foreground/60",
  caution: "bg-warning",
  auth: "bg-info",
  neutral: "bg-muted-foreground/40",
};

export function ActivityPanel({ projectId }: { projectId: ProjectId }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = useQuery({
    ...orpc.audit.listForProject.queryOptions({ input: { projectId, limit } }),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  if (query.isLoading) return <ActivityPending />;
  if (query.isError) {
    return <CenterMessage text="Couldn't load activity — retrying on the next refresh." />;
  }

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  if (items.length === 0) {
    return (
      <CenterMessage text="No activity for this project yet. Deploys, staged changes, and settings edits will appear here." />
    );
  }

  const canLoadMore = items.length < total && limit < MAX_LIMIT;
  const truncated = total > MAX_LIMIT && limit >= MAX_LIMIT;

  return (
    <div className="h-full overflow-auto">
      {items.map((event) => (
        <ActivityRow key={event.id} event={event} />
      ))}
      {canLoadMore ? (
        <button
          type="button"
          onClick={() => setLimit((l) => Math.min(MAX_LIMIT, l + PAGE_SIZE))}
          disabled={query.isFetching}
          className="block w-full py-2 text-center text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
        >
          {query.isFetching ? "Loading…" : `Load more (${total - items.length} older)`}
        </button>
      ) : truncated ? (
        <div className="py-2 text-center text-[11px] text-muted-foreground/70">
          Showing the latest {MAX_LIMIT} events — the Audit page has full history.
        </div>
      ) : null}
    </div>
  );
}

function ActivityRow({ event }: { event: ProjectAuditEvent }) {
  const actor = event.actorLabel ?? event.actorEmail ?? event.actorId;
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border/40 px-4 py-2 text-[12px]",
        event.outcome === "failure" && "bg-destructive/5",
        event.outcome === "denied" && "bg-warning/5",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[actionTone(event.action)])}
      />
      <span className="shrink-0 font-mono text-[11.5px] text-foreground/85">{event.action}</span>
      <span className="min-w-0 truncate text-muted-foreground">{actor}</span>
      {event.targetType && event.targetId ? (
        <span className="hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
          {event.targetType}:{event.targetId}
        </span>
      ) : null}
      {event.outcome !== "success" ? (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-px text-[10.5px] font-medium",
            event.outcome === "failure" && "bg-destructive/10 text-destructive",
            event.outcome === "denied" && "bg-warning/10 text-warning",
          )}
        >
          {event.outcome === "failure" ? "failed" : "denied"}
        </span>
      ) : null}
      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground/70">
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );
}

function ActivityPending() {
  return (
    <div className="h-full overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5">
          <Skeleton className="size-1.5 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="ml-auto h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

function CenterMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}
