/**
 * The header activity indicator — "is anything queued or building, anywhere?"
 *
 * The complement to the notification bell beside it, and deliberately a separate
 * control: the bell is HISTORY (things that happened, which you may not have
 * read), this is PRESENT STATE (work the platform still owes you). Folding both
 * into one dot is what made the old pulsing bell ring unreadable — it could not
 * say whether it meant "unread" or "building", and it was project-scoped so it
 * lied about every build outside the project you were looking at.
 *
 * It renders NOTHING when the workspace is idle. An indicator that is always
 * present is chrome you stop seeing; one that appears only when there is work is
 * a thing you notice (DESIGN.md, calm-density). The cost is that its absence has
 * to be trustworthy, which is why the server ages out stranded rows rather than
 * counting them forever.
 */

import { Loading03Icon, Queue01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type { DeployActivityItem } from "@/features/activity/use-deploy-activity";

import { useDeployActivity } from "@/features/activity/use-deploy-activity";
import { CancelDeploymentButton } from "@/features/deployments/components/cancel-deployment-button";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

/**
 * How long this row has been waiting or building — a DURATION, not a timestamp.
 * "queued 4m" is the number an operator acts on; "queued at 14:02" makes them do
 * the subtraction themselves.
 */
function elapsedSince(iso: string, now: number): string {
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return "";
  const secs = Math.max(0, Math.round((now - started) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}

/** The pill's own text. Both numbers when both apply — "5" alone would leave you
 *  unable to tell five parallel builds from a five-deep backlog. */
function summary(building: number, queued: number): string {
  const parts: string[] = [];
  if (building > 0) parts.push(`${building} building`);
  if (queued > 0) parts.push(`${queued} queued`);
  return parts.join(" · ");
}

function ActivityRow({
  item,
  now,
  orgSlug,
}: {
  item: DeployActivityItem;
  now: number;
  orgSlug: string;
}) {
  const building = item.status === "building";

  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
      {/* Filled = working, hollow = waiting its turn. Shape carries the
          distinction so it survives greyscale and the colour-blind case. */}
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          building
            ? "bg-[var(--brand-accent)]"
            : "bg-transparent ring-1 ring-muted-foreground/40 ring-inset",
        )}
      />

      <Link
        to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
        params={{
          orgSlug,
          projectSlug: item.projectSlug,
          resourceId: item.resourceId,
          deploymentId: item.id,
        }}
        // Straight to the build log. Every row here is a build you are waiting
        // on, and "what is it doing right now" is the only reason to click.
        search={{ deploymentTab: "build-logs" }}
        className="flex min-w-0 flex-1 flex-col gap-0.5"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {item.resourceName}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {elapsedSince(item.createdAt, now)}
          </span>
        </span>
        <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <span className="truncate">{item.projectName}</span>
          <span aria-hidden>·</span>
          <span>{building ? "building" : "queued"}</span>
          {item.gitRef ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate font-mono text-[10px]">{item.gitRef}</span>
            </>
          ) : null}
        </span>
      </Link>

      <CancelDeploymentButton
        deploymentId={item.id}
        status={item.status}
        compact
        className="size-7 shrink-0"
      />
    </div>
  );
}

export function ActivityIndicator({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const { items, building, queued, total, builderStalled, busy, fetchedAt } = useDeployActivity();

  // Idle workspace → no control at all. See the module comment.
  if (!busy) return null;

  const label = `${t("activity.title")} — ${summary(building, queued)}${
    builderStalled ? t("activity.builderStalledSuffix") : ""
  }`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={label}
            className={cn(
              "h-8 gap-1.5 px-2 font-normal",
              // A stalled builder is the one state here that is not just
              // progress — queued work with nothing consuming it needs to look
              // different from queued work that is draining.
              builderStalled && "border-warning/40 text-warning",
            )}
          >
            <HugeiconsIcon
              icon={building > 0 && !builderStalled ? Loading03Icon : Queue01Icon}
              strokeWidth={2}
              className={cn(
                "size-3.5",
                // The one place motion belongs: a spinner on a control that
                // exists to mean "work in progress" is literal, not decorative.
                // `motion-safe:` so it parks as a static glyph under
                // prefers-reduced-motion rather than disappearing.
                building > 0 && !builderStalled && "motion-safe:animate-spin",
              )}
            />
            {/* Below `sm` the header is already fighting for room — the count
                alone still answers "is anything happening?", which is the
                question the pill exists for. */}
            <span className="hidden font-mono text-xs tabular-nums lg:inline">
              {summary(building, queued)}
            </span>
            <span className="font-mono text-xs tabular-nums lg:hidden">{total}</span>
          </Button>
        }
      />

      <PopoverContent align="end" className="w-80 max-w-[92vw] gap-0 p-0">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <span className="text-[13px] font-medium">{t("activity.title")}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {summary(building, queued)}
          </span>
        </div>

        {builderStalled ? (
          // The signal a bare count cannot give you: "3 queued" is ordinary
          // behind an active build and a broken builder behind nothing.
          <p className="border-b bg-warning/10 px-3 py-2 text-[11px] text-warning-foreground">
            {queued} {queued === 1 ? "build is" : "builds are"} waiting and nothing is picking them
            up — the build worker may be down.
          </p>
        ) : null}

        <div className="max-h-96 overflow-y-auto p-1">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} now={fetchedAt} orgSlug={orgSlug} />
          ))}
          {total > items.length ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
              + {total - items.length} more
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
