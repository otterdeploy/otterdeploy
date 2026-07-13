/**
 * Per-channel delivery history — opened from the channel card ("View
 * deliveries" / clicking the stats row). Answers "what actually went through
 * THIS destination?": a 7-day per-event breakdown up top, then the raw
 * delivery log (newest first, keyset load-more) with provider errors inline.
 * Backed by `notifications.deliveries`; all rows are real `notification_
 * delivery` records — no synthesized history.
 */
import type { ReactNode } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Spinner } from "@/shared/components/ui/spinner";
import { client, orpc } from "@/shared/server/orpc";

import {
  type Channel,
  KIND_META,
  SEVERITY_DOT,
  eventLabel,
  eventSeverityOf,
  relativeTime,
} from "./shared";

type DeliveriesPage = Awaited<ReturnType<typeof client.notifications.deliveries>>;

const PAGE_SIZE = 50;

interface DeliveryHistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The channel whose log to show; null while closed. */
  channel: Channel | null;
}

export function DeliveryHistoryDialog({ open, onOpenChange, channel }: DeliveryHistoryDialogProps) {
  const channelId = channel?.id;
  const query = useInfiniteQuery({
    queryKey: [...orpc.notifications.deliveries.key(), channelId],
    enabled: open && channel !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.notifications.deliveries({
        // enabled-gated: only runs with a channel present.
        channelId: channelId as Channel["id"],
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam as DeliveriesPage["items"][number]["id"] } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const pages = query.data?.pages ?? [];
  // The 7d breakdown is identical on every page — read it off the first.
  const breakdown = pages[0]?.breakdown7d ?? [];
  const items = pages.flatMap((p) => p.items);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        {channel && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <SvglLogo
                  search={KIND_META[channel.kind].search}
                  fallback={KIND_META[channel.kind].label}
                  size={28}
                />
                <div className="min-w-0">
                  <DialogTitle className="text-left">{channel.name}</DialogTitle>
                  <DialogDescription className="text-left">
                    {KIND_META[channel.kind].label} · {channel.transport}
                  </DialogDescription>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {channel.target}
                  </div>
                </div>
              </div>
            </DialogHeader>

            {query.isPending ? (
              <LoadingRows />
            ) : query.isError ? (
              <ErrorRow
                message={
                  query.error instanceof Error ? query.error.message : "Couldn't load deliveries"
                }
                onRetry={() => void query.refetch()}
              />
            ) : items.length === 0 ? (
              <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-[12px] text-muted-foreground">
                No deliveries through this channel yet. Send a test from the card or subscribe it to
                events in the matrix below.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <Breakdown rows={breakdown} />
                <RecentList
                  items={items}
                  hasMore={query.hasNextPage}
                  loadingMore={query.isFetchingNextPage}
                  onLoadMore={() => void query.fetchNextPage()}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/** 7-day per-event totals; failures get the only red on the panel. */
function Breakdown({ rows }: { rows: DeliveriesPage["breakdown7d"] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Events · last 7 days</SectionLabel>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Nothing in the last 7 days — older deliveries are listed below.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          {rows.map((r, i) => (
            <div
              key={r.eventId}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
              style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[eventSeverityOf(r.eventId)]}`}
              />
              <span className="min-w-0 flex-1 truncate">{eventLabel(r.eventId)}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{r.eventId}</span>
              <span className="w-14 text-right font-mono text-[11px] text-foreground">
                {r.delivered}
                <span className="text-muted-foreground"> ok</span>
              </span>
              <span
                className={`w-16 text-right font-mono text-[11px] ${
                  r.failed > 0 ? "text-red-600 dark:text-red-500" : "text-muted-foreground/50"
                }`}
              >
                {r.failed} failed
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentList({
  items,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: DeliveriesPage["items"];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Recent deliveries</SectionLabel>
      <div className="max-h-[300px] overflow-y-auto rounded-md border">
        {items.map((d, i) => (
          <div
            key={d.id}
            className="flex items-start gap-2 px-3 py-2 text-[12px]"
            style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
          >
            <span
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                d.status === "delivered" ? "bg-emerald-500" : "bg-red-500"
              }`}
              aria-label={d.status}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate">{eventLabel(d.eventId)}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {d.eventId}
                </span>
              </div>
              {d.status === "failed" && d.error && (
                <div className="mt-0.5 truncate text-[11px] text-red-600 dark:text-red-500">
                  {d.error}
                </div>
              )}
            </div>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {relativeTime(new Date(d.createdAt).toISOString())}
            </span>
          </div>
        ))}
      </div>
      {hasMore && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore && <Spinner className="size-3.5" />}
          Load more
        </Button>
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-4">
      <p className="text-[12px] text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
