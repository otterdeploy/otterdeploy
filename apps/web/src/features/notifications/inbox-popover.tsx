/**
 * The header bell — an in-app notification inbox in a popover, not a page.
 * One polled query carries both the unread badge and the popover list; rows
 * mark themselves read on click, and the footer keeps a path to the channel
 * settings the bell used to navigate to.
 */
import { Notification03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { relativeTime } from "@/features/notifications/shared";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

type InboxData = Awaited<ReturnType<typeof orpc.notifications.inbox.list.call>>;
type InboxItem = InboxData["items"][number];

const inboxInput = { input: {} } as const;

function useInbox() {
  return useQuery({
    ...orpc.notifications.inbox.list.queryOptions(inboxInput),
    refetchInterval: 30_000,
  });
}

function invalidateInbox() {
  void queryClient.invalidateQueries({
    queryKey: orpc.notifications.inbox.list.queryKey(inboxInput),
  });
}

function InboxRow({ item, onRead }: { item: InboxItem; onRead: (id: InboxItem["id"]) => void }) {
  const unread = item.readAt === null;
  return (
    <button
      type="button"
      onClick={() => {
        if (unread) onRead(item.id);
      }}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
        unread ? "hover:bg-accent" : "cursor-default",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          unread ? "bg-info" : "bg-transparent",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              unread ? "font-medium text-foreground" : "text-foreground/75",
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {relativeTime(new Date(item.createdAt).toISOString())}
          </span>
        </span>
        {item.message ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.message}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function NotificationInboxPopover({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const inbox = useInbox();

  const markRead = useMutation(
    orpc.notifications.inbox.markRead.mutationOptions({ onSuccess: invalidateInbox }),
  );
  const markAllRead = useMutation(
    orpc.notifications.inbox.markAllRead.mutationOptions({ onSuccess: invalidateInbox }),
  );

  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unread ?? 0;
  const label =
    unread > 0
      ? t("common.notificationsUnread", "Notifications — {{count}} unread", { count: unread })
      : t("common.notifications");

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative h-8 w-8" aria-label={label}>
            <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} className="size-[1.1rem]" />
            {unread > 0 ? (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 size-2 rounded-full bg-info ring-2 ring-background"
              />
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96 max-w-[92vw] gap-0 p-0">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <span className="text-[13px] font-medium">
            {t("common.notifications", "Notifications")}
          </span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate({})}
            >
              Mark all read
            </Button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto p-1">
          {inbox.isLoading ? (
            <div className="flex flex-col gap-1 p-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
              <HugeiconsIcon
                icon={Notification03Icon}
                strokeWidth={1.5}
                className="mb-1 size-6 text-muted-foreground/40"
              />
              <p className="text-[13px] text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground/70">
                Deploy, build, and backup events land here.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <InboxRow key={item.id} item={item} onRead={(id) => markRead.mutate({ id })} />
            ))
          )}
        </div>

        <div className="border-t p-1">
          <Link
            to="/$orgSlug/settings/workspace/notifications"
            params={{ orgSlug }}
            className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
