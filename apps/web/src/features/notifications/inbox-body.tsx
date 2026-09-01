/**
 * The popover's list body: attention cards, then settled history by subject.
 *
 * Split from inbox-popover.tsx so that file stays about the query, the
 * badge and the popover frame, and this stays about what the two lists look
 * like. Both were over the size cap together.
 */
import type { NotificationId } from "@otterdeploy/shared/id";

import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

import type { SettledGroup } from "./inbox-fold";
import type { InboxItem, OpenCondition } from "./inbox-types";
import type { InboxViewState } from "./inbox-view-state";

import { InboxAttentionCard } from "./inbox-attention-card";
import { InboxSettledGroup } from "./inbox-settled-group";

/**
 * Which body the popover shows, in the order that matters: error is checked
 * BEFORE empty (inboxViewState), because a failed fetch leaves both lists
 * empty, and "No notifications yet" for a request that 500'd is the app
 * stating as fact that nothing happened.
 */
export function InboxPanel({
  view,
  error,
  onRetry,
  children,
}: {
  view: InboxViewState;
  error: unknown;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  switch (view) {
    case "loading":
      return (
        <div className="flex flex-col gap-1 p-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      );
    case "error":
      return (
        <ErrorState
          className="py-6"
          title={t("notifications.loadFailed")}
          message={error instanceof Error ? error.message : undefined}
          onRetry={onRetry}
        />
      );
    case "empty":
      return (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <HugeiconsIcon
            icon={BellDotIcon}
            strokeWidth={1.5}
            className="mb-1 size-6 text-muted-foreground/40"
          />
          <p className="text-[13px] text-muted-foreground">{t("notifications.empty")}</p>
          <p className="text-xs text-muted-foreground/70">{t("notifications.emptyHint")}</p>
        </div>
      );
    case "list":
      return children;
  }
}

function SectionHead({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 pb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
      <span>{label}</span>
      {count !== undefined ? <span className="font-mono tracking-normal">{count}</span> : null}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function InboxBody({
  attention,
  groups,
  orgSlug,
  isInstallAdmin,
  onRead,
  onSnooze,
  onDismiss,
  onNavigate,
}: {
  attention: OpenCondition[];
  groups: SettledGroup<InboxItem>[];
  orgSlug: string;
  isInstallAdmin: boolean;
  onRead: (ids: NotificationId[]) => void;
  onSnooze: (condition: OpenCondition) => void;
  onDismiss: (condition: OpenCondition) => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SectionHead label={t("notifications.needsAttention")} count={attention.length} />
      {attention.length > 0 ? (
        attention.map((condition) => (
          <InboxAttentionCard
            key={condition.key}
            condition={condition}
            orgSlug={orgSlug}
            isInstallAdmin={isInstallAdmin}
            onSnooze={onSnooze}
            onDismiss={onDismiss}
            onNavigate={onNavigate}
          />
        ))
      ) : (
        <p className="px-2 pt-1 pb-3 text-[12px] text-muted-foreground">
          {t("notifications.allClear")}
        </p>
      )}
      {groups.length > 0 ? (
        <>
          <SectionHead label={t("notifications.earlier")} />
          <ul role="list" className="contents">
            {groups.map((group) => (
              <li key={group.key}>
                <InboxSettledGroup
                  group={group}
                  orgSlug={orgSlug}
                  onRead={onRead}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
