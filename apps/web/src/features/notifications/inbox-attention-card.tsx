/**
 * One open condition, as a card with the thing that resolves it.
 *
 * A card is not a row: it is a problem that is still true, so it carries
 * how long it has been true, how many times it was said, and — where the
 * inbox can do it — a button that ends it (reclaim for disk pressure), plus
 * the links that explain it. Snooze and dismiss are per condition and local
 * to this browser (inbox-hidden.ts).
 *
 * Reclaim is an install-admin procedure; for everyone else the same slot
 * shows "Open server", so the card never offers a button that would 403.
 */
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { OpenCondition } from "./inbox-types";

import { InboxLink, type InboxTarget, inboxTarget } from "./inbox-link";
import { relativeTime, SEVERITY_DOT } from "./shared";

const RECLAIM_LABEL = {
  images: "notifications.reclaimImages",
  "build-cache": "notifications.reclaimBuildCache",
  "branch-pool": "notifications.reclaimBranchPool",
} as const;

const LINK_CLASS =
  "inline-flex h-6 items-center rounded-md border border-input px-2 text-[11px] transition-colors hover:bg-accent";

/** The links that explain a condition: where it is, and what it did. */
function CardLinks({
  condition,
  target,
  orgSlug,
  onNavigate,
}: {
  condition: OpenCondition;
  target: InboxTarget;
  orgSlug: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const link = (label: string, view?: "build-log") => (
    <InboxLink
      orgSlug={orgSlug}
      target={target}
      view={view}
      className={LINK_CLASS}
      onClick={onNavigate}
    >
      {label}
    </InboxLink>
  );
  switch (target.kind) {
    case "service": {
      const failedBuild =
        condition.eventId === "deploy.failed" || condition.eventId === "build.failed";
      return (
        <>
          {link(t("notifications.viewDeployment"))}
          {failedBuild ? link(t("notifications.buildLog"), "build-log") : null}
        </>
      );
    }
    case "servers":
      return link(t("notifications.openServer"));
    case "backups":
      return link(t("notifications.openBackups"));
    case "edge":
      return link(t("notifications.openEdge"));
  }
}

function ReclaimButton({ target }: { target: NonNullable<OpenCondition["action"]>["target"] }) {
  const { t } = useTranslation();
  const reclaim = useMutation({
    ...orpc.system.reclaim.mutationOptions(),
    onSuccess: (result) => {
      const gb = (result.reclaimedBytes / 1024 ** 3).toFixed(1);
      toast.success(t("notifications.reclaimed", { size: `${gb} GB` }));
      void queryClient.invalidateQueries({ queryKey: orpc.system.hostHealth.queryKey() });
      void queryClient.invalidateQueries({ queryKey: orpc.notifications.inbox.list.key() });
    },
    onError: () => toast.error(t("notifications.reclaimFailed")),
  });
  return (
    <Button
      size="sm"
      className="h-6 px-2 text-[11px]"
      disabled={reclaim.isPending}
      onClick={() => reclaim.mutate({ targets: [target] })}
    >
      {t(RECLAIM_LABEL[target])}
    </Button>
  );
}

export function InboxAttentionCard({
  condition,
  orgSlug,
  isInstallAdmin,
  onSnooze,
  onDismiss,
  onNavigate,
}: {
  condition: OpenCondition;
  orgSlug: string;
  isInstallAdmin: boolean;
  onSnooze: (condition: OpenCondition) => void;
  onDismiss: (condition: OpenCondition) => void;
  /** Close the popover: a link that navigates under an open popover reads as nothing happening. */
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const target = inboxTarget(condition.subject, condition.data);
  const action = condition.action;

  const meta = [
    condition.count > 1
      ? t("notifications.occurrences", {
          count: condition.count,
          since: relativeTime(condition.firstAt.toISOString()),
          last: relativeTime(condition.lastAt.toISOString()),
        })
      : relativeTime(condition.lastAt.toISOString()),
    condition.subject?.label,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "mx-1 mb-1.5 rounded-md border p-2.5",
        condition.severity === "err" ? "border-destructive/40" : "border-warning/40",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-[5px] size-1.5 shrink-0 rounded-full",
            SEVERITY_DOT[condition.severity],
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-snug font-medium">{condition.title}</div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {meta}
          </div>
        </div>
      </div>
      {condition.message ? (
        <p className="mt-1.5 line-clamp-3 pl-[0.875rem] text-xs leading-relaxed text-muted-foreground">
          {condition.message}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[0.875rem]">
        {action && isInstallAdmin ? <ReclaimButton target={action.target} /> : null}
        {target ? (
          <CardLinks
            condition={condition}
            target={target}
            orgSlug={orgSlug}
            onNavigate={onNavigate}
          />
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className="px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onSnooze(condition)}
        >
          {t("notifications.snooze")}
        </button>
        <button
          type="button"
          className="px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onDismiss(condition)}
        >
          {t("notifications.dismiss")}
        </button>
      </div>
    </div>
  );
}
