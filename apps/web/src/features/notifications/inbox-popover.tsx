import type { NotificationId } from "@otterdeploy/shared/id";

/**
 * The header bell: an in-app notification inbox in a popover, not a page.
 *
 * Two lists, not one. The server folds rows into what still NEEDS ATTENTION
 * (a pressure warning without its clear, a failed deploy without a later
 * success, a degraded service not yet recovered), and the rest is history.
 * The first is cards with the action that ends them; the second is grouped
 * under what it is about, unread groups open, read groups folded. Time
 * order across the two is what made the old flat list unreadable: one
 * failure buried under thirty repeats of a warning.
 *
 * The badge answers "how many problems are open?", in the worst colour, and
 * only falls back to "how many things haven't I seen?" when nothing is
 * open. It goes to zero when problems are fixed, not when they are clicked.
 * Live work (building, queued) is the activity indicator beside it, not this.
 */
import { useState } from "react";

import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useDeployActivity } from "@/features/activity/use-deploy-activity";
import { BellBadge, bellLabel } from "@/features/notifications/bell-badge";
import { deriveInboxView } from "@/features/notifications/inbox-fold";
import { inboxViewState } from "@/features/notifications/inbox-view-state";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { HiddenConditions } from "./inbox-hidden";
import type { OpenCondition } from "./inbox-types";

import { InboxBody, InboxPanel } from "./inbox-body";
import { pruneHidden, readHidden, withHidden, writeHidden } from "./inbox-hidden";

/**
 * Ask for the largest page the contract allows rather than letting the server
 * default to 20. Open conditions arrive separately and are never paged.
 */
const INBOX_PAGE_SIZE = 50;

const inboxInput = { input: { limit: INBOX_PAGE_SIZE } } as const;

/** Idle cadence. The notification-inbox job pushes an `inbox` resync over the
 *  org event stream the moment rows land (use-org-events), so the idle tick
 *  is only a dead-stream backstop; the poll still tightens while work is in
 *  flight for the terminal-notification case. */
const INBOX_POLL_IDLE_MS = 180_000;
const INBOX_POLL_ACTIVE_MS = 5_000;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function invalidateInbox() {
  void queryClient.invalidateQueries({
    queryKey: orpc.notifications.inbox.list.queryKey(inboxInput),
  });
}

/** Snoozes and dismissals: read once per mount, written through on change. */
function useHiddenConditions(orgSlug: string) {
  const [hidden, setHidden] = useState(() => pruneHidden(readHidden(orgSlug), Date.now()));
  const hide = (condition: OpenCondition, until: number | null) => {
    const next = withHidden(hidden, condition, until);
    setHidden(next);
    writeHidden(orgSlug, next);
  };
  return { hidden, hide };
}

/** Reports failure: a silent revert on the next poll reads as the app undoing
 *  what you just asked for. */
function useMarkRead() {
  const { t } = useTranslation();
  const mutation = useMutation(
    orpc.notifications.inbox.markReadMany.mutationOptions({
      onSuccess: invalidateInbox,
      onError: () => toast.error(t("notifications.markReadFailed")),
    }),
  );
  return {
    pending: mutation.isPending,
    onRead: (ids: NotificationId[]) => {
      if (ids.length > 0) mutation.mutate({ ids });
    },
  };
}

/** The list query and everything derived from it. */
function useInboxModel(hidden: HiddenConditions) {
  // Shares the header pill's query (same key, so no second timer). Used only to
  // decide how fast to poll, never to render. The bell says nothing about builds.
  const { busy } = useDeployActivity();
  const inbox = useQuery({
    ...orpc.notifications.inbox.list.queryOptions(inboxInput),
    refetchInterval: busy ? INBOX_POLL_ACTIVE_MS : INBOX_POLL_IDLE_MS,
  });
  const unread = inbox.data?.unread ?? 0;
  const model = deriveInboxView({
    open: inbox.data?.open ?? [],
    items: inbox.data?.items ?? [],
    unread,
    hidden,
    // "Now" for snooze expiry is the last time the data moved, not the wall
    // clock: pure during render, and a lapsed snooze resurfaces on the next
    // poll, which is as fresh as anything else in this popover.
    now: inbox.dataUpdatedAt,
  });
  const view = inboxViewState({
    isLoading: inbox.isLoading,
    isError: inbox.isError,
    itemCount: model.attention.length + model.groups.length,
  });
  return { inbox, unread, model, view };
}

export function NotificationInboxPopover({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const { isInstallAdmin } = useRouteContext({ from: "/_app" });
  const [open, setOpen] = useState(false);
  const { hidden, hide } = useHiddenConditions(orgSlug);
  const { pending, onRead } = useMarkRead();
  const { inbox, unread, model, view } = useInboxModel(hidden);

  const badge = model.badge;
  const label = bellLabel({
    unread:
      unread > 0
        ? t("common.notifications.unread", "Notifications: {{count}} unread", { count: unread })
        : t("common.notifications.title", "Notifications"),
    failure:
      badge?.severity === "err"
        ? t("common.notifications.labelFailure", "includes a failure")
        : null,
  });
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative h-8 w-8" aria-label={label}>
            <HugeiconsIcon icon={BellDotIcon} strokeWidth={2} className="size-[1.1rem]" />
            <BellBadge severity={badge?.severity ?? null} count={badge?.count ?? 0} />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[26rem] max-w-[92vw] gap-0 p-0">
        {/* PopoverTitle, not a bare span: it is what gives the popup its
            accessible name. As a span the dialog announced as unlabelled. */}
        <div className="flex h-9 items-center justify-between border-b px-3">
          <PopoverTitle className="text-[13px] font-medium">
            {t("common.notifications.title", "Notifications")}
          </PopoverTitle>
          {model.settledUnreadIds.length > 0 ? (
            // Clears HISTORY only. Open problems are not something "read"
            // resolves, so no button here can make a card disappear.
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={pending}
              onClick={() => onRead(model.settledUnreadIds)}
            >
              {t("notifications.clearSettled")}
            </Button>
          ) : null}
        </div>

        <div className="max-h-[28rem] overflow-y-auto p-1">
          <InboxPanel view={view} error={inbox.error} onRetry={() => void inbox.refetch()}>
            <InboxBody
              attention={model.attention}
              groups={model.groups}
              orgSlug={orgSlug}
              isInstallAdmin={isInstallAdmin}
              onRead={onRead}
              onSnooze={(c) => hide(c, Date.now() + SNOOZE_MS)}
              onDismiss={(c) => {
                onRead(c.occurrenceIds);
                hide(c, null);
              }}
              onNavigate={close}
            />
          </InboxPanel>
        </div>

        {/* Say so rather than letting the list quietly stop at the page size. */}
        {model.hiddenUnread > 0 ? (
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {t("notifications.olderNotShown", { count: model.hiddenUnread })}
          </p>
        ) : null}

        <div className="border-t p-1">
          <Link
            to="/$orgSlug/notifications"
            params={{ orgSlug }}
            onClick={close}
            className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("notifications.settingsLink")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
