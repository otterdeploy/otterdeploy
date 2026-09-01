import type { NotificationId } from "@otterdeploy/shared/id";

/**
 * Settled history for one subject: a header that says what and how much,
 * then the rows.
 *
 * Open by default only while it holds something unread; a group of things
 * you have already seen is a heading you can expand, not a list you scroll
 * past. Three rows preview, the rest behind one "show more", so a subject
 * with forty entries takes the same space as one with three.
 */
import { useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import type { SettledGroup } from "./inbox-fold";
import type { InboxItem } from "./inbox-types";

import { InboxRow } from "./inbox-row";
import { SEVERITY_DOT } from "./shared";

const PREVIEW = 3;

const KIND_KEY = {
  server: "notifications.kindServer",
  service: "notifications.kindService",
  backup: "notifications.kindBackup",
  edge: "notifications.kindEdge",
  account: null,
} as const;

export function InboxSettledGroup({
  group,
  orgSlug,
  onRead,
  onNavigate,
}: {
  group: SettledGroup<InboxItem>;
  orgSlug: string;
  onRead: (ids: NotificationId[]) => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(group.unread > 0);
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? group.rows : group.rows.slice(0, PREVIEW);
  const hidden = group.rows.length - rows.length;
  const kindKey = group.subject ? KIND_KEY[group.subject.kind] : null;
  const unreadIds = group.rows.flatMap((row) => (row.unread ? row.ids : []));

  return (
    <div>
      <div className="group/head flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              group.severity ? SEVERITY_DOT[group.severity] : "ring-1 ring-border ring-inset",
            )}
          />
          <span className="truncate text-[12.5px] font-medium">
            {group.subject?.label ?? t("notifications.otherGroup")}
          </span>
          {kindKey ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {t(kindKey)}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {group.unread > 0 ? group.unread : group.rows.length}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>
        {unreadIds.length > 0 ? (
          <button
            type="button"
            onClick={() => onRead(unreadIds)}
            className="mr-1 shrink-0 rounded-md px-1.5 py-1 text-[10.5px] text-muted-foreground opacity-0 transition-opacity group-hover/head:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            {t("notifications.groupMarkRead")}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="pl-3">
          {rows.map((row) => (
            <InboxRow
              key={row.item.id}
              item={row.item}
              count={row.count}
              ids={row.ids}
              unread={row.unread}
              orgSlug={orgSlug}
              onRead={onRead}
              onNavigate={onNavigate}
            />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="px-2 py-1 pl-[1.75rem] text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("notifications.showMore", { count: hidden })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
