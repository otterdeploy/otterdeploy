/**
 * The header bell: an in-app notification inbox in a popover, not a page.
 * One polled query carries both the unread badge and the popover list; a row
 * expands in place on click to show its full message + structured context and
 * marks itself read, and the footer keeps a path to the channel settings.
 *
 * The badge reports exactly one thing: "is there anything I haven't looked at?"
 * It used to also report "is anything building right now?", which made a single
 * 8px dot answer two unrelated questions, and answered the second one badly,
 * since the app-status rollup it read is project-scoped. Live work belongs to
 * the activity indicator sitting next to it in the header.
 */
import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useDeployActivity } from "@/features/activity/use-deploy-activity";
import { BellBadge, bellLabel } from "@/features/notifications/bell-badge";
import { hiddenUnreadCount, inboxViewState, worstSeverity } from "@/features/notifications/shared";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc, queryClient } from "@/shared/server/orpc";

import { InboxRow } from "./inbox-row";

/**
 * Ask for the largest page the contract allows rather than letting the server
 * default to 20.
 *
 * With the default, a user holding 45 unread saw a lit badge, a "Mark all read"
 * button, and twenty rows, with nothing anywhere saying the other twenty-five
 * existed — and "Mark all read" clears every unread row, not just the rendered
 * ones, so it silently discarded notifications they were never shown. 50 is the
 * contract's ceiling; past it the footer says how many are still hidden.
 */
const INBOX_PAGE_SIZE = 50;

const inboxInput = { input: { limit: INBOX_PAGE_SIZE } } as const;

/** Idle cadence. The notification-inbox job pushes an `inbox` resync over the
 *  org event stream the moment rows land (use-org-events), so the idle tick
 *  is only a dead-stream backstop; the poll still tightens while work is in
 *  flight (see {@link useInbox}) for the terminal-notification case. */
const INBOX_POLL_IDLE_MS = 180_000;
const INBOX_POLL_ACTIVE_MS = 5_000;

function useInbox(busy: boolean) {
  return useQuery({
    ...orpc.notifications.inbox.list.queryOptions(inboxInput),
    // At the idle 30s cadence a "build failed" row could sit invisible for half
    // a minute after the build actually failed. Long enough for an operator
    // watching the header to conclude nothing happened. While anything is
    // queued or building, poll at the same 5s beat the activity pill uses.
    refetchInterval: busy ? INBOX_POLL_ACTIVE_MS : INBOX_POLL_IDLE_MS,
  });
}

function invalidateInbox() {
  void queryClient.invalidateQueries({
    queryKey: orpc.notifications.inbox.list.queryKey(inboxInput),
  });
}

export function NotificationInboxPopover({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  // Shares the header pill's query (same key, so no second timer). Used only to
  // decide how fast to poll, never to render. The bell says nothing about builds.
  const { busy } = useDeployActivity();
  const inbox = useInbox(busy);

  // Both mutations report failure. Without an onError they succeeded silently
  // in the UI and then reverted on the next poll, which reads as the app
  // undoing what you just asked for.
  const markRead = useMutation(
    orpc.notifications.inbox.markRead.mutationOptions({
      onSuccess: invalidateInbox,
      onError: () => toast.error(t("notifications.markReadFailed")),
    }),
  );
  const markAllRead = useMutation(
    orpc.notifications.inbox.markAllRead.mutationOptions({
      onSuccess: invalidateInbox,
      onError: () => toast.error(t("notifications.markAllReadFailed")),
    }),
  );

  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unread ?? 0;
  const hiddenUnread = hiddenUnreadCount({ unread, itemCount: items.length });
  const view = inboxViewState({
    isLoading: inbox.isLoading,
    isError: inbox.isError,
    itemCount: items.length,
  });
  // Only unread rows drive the badge. A failure you have already read is
  // history, and leaving it lit would make the bell permanently red.
  const severity = worstSeverity(items.filter((item) => item.readAt === null));

  const label = bellLabel({
    unread:
      unread > 0
        ? t("common.notifications.unread", "Notifications: {{count}} unread", { count: unread })
        : t("common.notifications.title", "Notifications"),
    failure:
      severity === "err" ? t("common.notifications.labelFailure", "includes a failure") : null,
  });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative h-8 w-8" aria-label={label}>
            <HugeiconsIcon icon={BellDotIcon} strokeWidth={2} className="size-[1.1rem]" />
            <BellBadge severity={unread > 0 ? severity : null} count={unread} />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96 max-w-[92vw] gap-0 p-0">
        {/* PopoverTitle, not a bare span: it is what gives the popup its
            accessible name. As a span the dialog announced as unlabelled. */}
        <div className="flex h-9 items-center justify-between border-b px-3">
          <PopoverTitle className="text-[13px] font-medium">
            {t("common.notifications.title", "Notifications")}
          </PopoverTitle>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate({})}
            >
              {t("notifications.markAllRead")}
            </Button>
          ) : null}
        </div>

        {/* Three distinct states, in this order. Error is checked BEFORE empty
            and that ordering is the whole point: a failed fetch leaves
            `items` empty, so without this branch a request that 500'd, timed
            out, or lost its session rendered "No notifications yet" — the app
            stating as fact that nothing had happened. Indistinguishable from a
            genuinely empty inbox, and the likeliest thing an operator reports
            as "the bell is broken". */}
        <div className="max-h-96 overflow-y-auto p-1">
          {view === "loading" ? (
            <div className="flex flex-col gap-1 p-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : view === "error" ? (
            <ErrorState
              className="py-6"
              title={t("notifications.loadFailed")}
              message={inbox.error instanceof Error ? inbox.error.message : undefined}
              onRetry={() => void inbox.refetch()}
            />
          ) : view === "empty" ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
              <HugeiconsIcon
                icon={BellDotIcon}
                strokeWidth={1.5}
                className="mb-1 size-6 text-muted-foreground/40"
              />
              <p className="text-[13px] text-muted-foreground">{t("notifications.empty")}</p>
              {/* Names what actually reaches this list. It used to promise
                  "Deploy, build, and backup events"; there is no
                  build.succeeded event, so builds only ever appear when they
                  fail, and health changes were never mentioned at all. */}
              <p className="text-xs text-muted-foreground/70">{t("notifications.emptyHint")}</p>
            </div>
          ) : (
            <ul role="list" className="contents">
              {items.map((item) => (
                <li key={item.id}>
                  <InboxRow item={item} onRead={(id) => markRead.mutate({ id })} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Say so rather than letting the list quietly stop at the page size. */}
        {hiddenUnread > 0 ? (
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {t("notifications.olderNotShown", { count: hiddenUnread })}
          </p>
        ) : null}

        <div className="border-t p-1">
          {/* Straight to the live route. The settings path this used to point
              at is a redirect shim kept for old emails and bookmarks
              (routes/_app/$orgSlug/settings/workspace/notifications.tsx), so
              every click from here was paying a redirect hop. */}
          <Link
            to="/$orgSlug/notifications"
            params={{ orgSlug }}
            className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("notifications.settingsLink")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
