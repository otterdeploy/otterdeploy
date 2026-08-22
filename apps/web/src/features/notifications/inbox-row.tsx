/**
 * One row of the header-bell inbox.
 *
 * Split out of inbox-popover.tsx for the same reason bell-badge.tsx was: that
 * file is about which of the four bodies to show and how the popover frames
 * them, and this is about how a single notification reads. Both were over the
 * file-size cap together.
 *
 * Collapsed it is a title + clamped message; clicking expands it in place to
 * reveal the full message and the notification's structured context (event,
 * resource, project, …) and marks it read on first open, so a click actually
 * shows something instead of just clearing the unread dot.
 */

import { useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  SEVERITY_DOT,
  eventLabel,
  eventSeverityOf,
  inboxDetailRows,
  inboxEventId,
  relativeTime,
} from "@/features/notifications/shared";
import { cn } from "@/shared/lib/utils";

import type { InboxItem } from "./inbox-types";

export function InboxRow({
  item,
  onRead,
}: {
  item: InboxItem;
  onRead: (id: InboxItem["id"]) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const unread = item.readAt === null;

  const eventId = inboxEventId(item.data);
  const severity = eventId ? eventSeverityOf(eventId) : "info";
  const eventName = eventId ? eventLabel(eventId) : null;
  const detail = inboxDetailRows(item.data);

  const toggle = () => {
    setExpanded((v) => !v);
    if (unread) onRead(item.id);
  };

  return (
    <div className={cn("rounded-md transition-colors", expanded && "bg-muted/40")}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
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
            <span
              className={cn(
                "truncate text-[13px]",
                unread ? "font-medium text-foreground" : "text-foreground/75",
              )}
            >
              {item.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {relativeTime(new Date(item.createdAt).toISOString())}
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
        <div className="flex flex-col gap-2 px-2 pb-2.5 pl-[1.75rem]">
          {eventName ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[severity])} />
              <span>{eventName}</span>
              <span className="font-mono text-[10px] text-muted-foreground/70">{eventId}</span>
            </div>
          ) : null}
          {detail.length > 0 ? (
            <dl className="overflow-hidden rounded-md border">
              {detail.map((r, i) => (
                <div
                  key={r.key}
                  className="flex items-start gap-3 px-2.5 py-1.5 text-[11px]"
                  style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
                >
                  <dt className="w-24 shrink-0 text-muted-foreground">{r.label}</dt>
                  <dd className="min-w-0 flex-1 font-mono break-words text-foreground">
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : !item.message && !eventName ? (
            <p className="text-[11px] text-muted-foreground/70">{t("notifications.noDetail")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
