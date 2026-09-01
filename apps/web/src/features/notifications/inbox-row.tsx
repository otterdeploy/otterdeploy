/**
 * One line of settled history in the header-bell inbox.
 *
 * Collapsed it is a title + clamped message; clicking expands it in place to
 * reveal the full message, the notification's structured context (event,
 * resource, project, …) and a link to the thing it is about, and marks it
 * read on first open, so a click actually shows something instead of just
 * clearing the unread dot.
 *
 * A line may stand for several identical rows (`count`): a condition that
 * re-notified before the emitter learned to stay quiet. Opening it marks
 * all of them read at once.
 */

import type { NotificationId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import type { InboxItem } from "./inbox-types";
import type { Severity } from "./shared";

import { itemSeverity, subjectOfItem } from "./inbox-fold";
import { InboxLink, inboxTarget } from "./inbox-link";
import { eventLabel, inboxDetailRows, inboxEventId, relativeTime, SEVERITY_DOT } from "./shared";

function RowDetail({
  item,
  severity,
  orgSlug,
  onNavigate,
}: {
  item: InboxItem;
  severity: Severity;
  orgSlug: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const eventId = inboxEventId(item.data);
  const eventName = eventId ? eventLabel(eventId) : null;
  const detail = inboxDetailRows(item.data);
  const target = inboxTarget(subjectOfItem(item.data), item.data);

  return (
    <div className="flex flex-col gap-2 px-2 pb-2.5 pl-[1.75rem]">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {eventName ? (
          <>
            <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[severity])} />
            <span>{eventName}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">{eventId}</span>
          </>
        ) : null}
        {target ? (
          <InboxLink
            orgSlug={orgSlug}
            target={target}
            className="ml-auto text-[11px] text-sidebar-primary hover:underline"
            onClick={onNavigate}
          >
            {t("notifications.open")} →
          </InboxLink>
        ) : null}
      </div>
      {detail.length > 0 ? (
        <dl className="overflow-hidden rounded-md border">
          {detail.map((r, i) => (
            <div
              key={r.key}
              className="flex items-start gap-3 px-2.5 py-1.5 text-[11px]"
              style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
            >
              <dt className="w-24 shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 flex-1 font-mono break-words text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : !item.message && !eventName ? (
        <p className="text-[11px] text-muted-foreground/70">{t("notifications.noDetail")}</p>
      ) : null}
    </div>
  );
}

export function InboxRow({
  item,
  count = 1,
  ids,
  unread,
  orgSlug,
  onRead,
  onNavigate,
}: {
  item: InboxItem;
  count?: number;
  /** Every row this line stands for; defaults to the item alone. */
  ids?: NotificationId[];
  unread: boolean;
  orgSlug: string;
  onRead: (ids: NotificationId[]) => void;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = itemSeverity(item.data);

  const toggle = () => {
    setExpanded((v) => !v);
    if (unread) onRead(ids ?? [item.id]);
  };

  return (
    <div className={cn("rounded-md transition-colors", expanded && "bg-muted/40")}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            unread ? SEVERITY_DOT[severity] : "bg-transparent ring-1 ring-border ring-inset",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span
                className={cn(
                  "truncate text-[13px]",
                  unread ? "font-medium text-foreground" : "text-foreground/75",
                )}
              >
                {item.title}
              </span>
              {count > 1 ? (
                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9.5px] text-muted-foreground">
                  ×{count}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {relativeTime(item.createdAt.toISOString())}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn(
                  "size-3.5 text-muted-foreground/60 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </span>
          </span>
          {item.message ? (
            <span
              className={cn(
                "text-xs leading-relaxed text-muted-foreground",
                !expanded && "line-clamp-2",
              )}
            >
              {item.message}
            </span>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <RowDetail item={item} severity={severity} orgSlug={orgSlug} onNavigate={onNavigate} />
      ) : null}
    </div>
  );
}
