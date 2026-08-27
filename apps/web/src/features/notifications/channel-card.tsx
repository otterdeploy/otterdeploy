/**
 * A notification channel as a compact grid card, deliberately the same shape as
 * a project card (features/projects/components/project-card.tsx): the same
 * `rounded-xl border bg-card p-4`, the same `gap-3` internal rhythm, the same
 * identity → preview → stats-footer stack, dropped into the same
 * `md:grid-cols-2 xl:grid-cols-3` grid. One card vocabulary across the app.
 *
 * Where a project card shows MiniCanvasPreview, this shows {@link CoverageStrip}
 * — one tick per subscribable event, lit when the channel is subscribed,
 * grouped into severity bands. Same job as the canvas thumbnail: a shape you
 * read instead of a number you parse. An all-grey strip is the honest picture
 * of a channel that was added and then never routed anything, which the old
 * matrix could only say as "0/17" buried in a table header.
 *
 * The card SELECTS; it does not navigate and it carries no action cluster. Its
 * five outline buttons (deliveries / test / edit / pause / delete) moved to the
 * routing panel's header, where there is one set for the selected channel
 * instead of one set per card competing with every other card's.
 */

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { cn } from "@/shared/lib/utils";

import { ChannelHeadStats } from "./channel-head-stats";
import {
  type Channel,
  EVENT_BANDS,
  KIND_META,
  SEVERITY_DOT,
  SEVERITY_GROUP_KEY,
  SUBSCRIBABLE_EVENTS,
  channelTargetHint,
} from "./shared";

/**
 * Per-band routing coverage: a tick per event, lit when subscribed, under a
 * band label. Purely a readout — the toggles live in the routing panel, so
 * this stays non-interactive and doesn't compete with the card's own click
 * target.
 */
function CoverageStrip({ subscribed }: { subscribed: Set<string> | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-1.5" aria-hidden>
      {EVENT_BANDS.map((band) => {
        const on = band.events.filter((e) => subscribed?.has(e.id) ?? false).length;
        return (
          <div key={band.severity} className="min-w-0 flex-1">
            <div className="flex gap-0.5">
              {band.events.map((e) => (
                <span
                  key={e.id}
                  className={cn(
                    "h-1.5 flex-1 rounded-[1px]",
                    subscribed?.has(e.id) ? SEVERITY_DOT[band.severity] : "bg-foreground/10",
                  )}
                />
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className={cn(
                  "size-1 shrink-0 rounded-full",
                  on > 0 ? SEVERITY_DOT[band.severity] : "bg-foreground/25",
                )}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {t(SEVERITY_GROUP_KEY[band.severity])}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChannelCard({
  channel,
  subscribed,
  selected,
  onSelect,
}: {
  channel: Channel;
  /** Event ids this channel is subscribed to. */
  subscribed: Set<string> | undefined;
  selected: boolean;
  onSelect: (c: Channel) => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[channel.kind];
  const routed = subscribed?.size ?? 0;

  // A channel that routes nothing delivers nothing. That is a state worth
  // showing on the card rather than leaving the operator to infer it from a
  // grey strip, so it gets the warning dot and its own footer line.
  const unrouted = routed === 0;
  const paused = channel.status === "paused";
  const broken = channel.status === "disconnected" || channel.status === "warn";

  return (
    <button
      type="button"
      // `aria-pressed` rather than a radio/tab: this is a toggle-selection in a
      // plain grid, and the routing panel below is `aria-live`-free static
      // content that simply re-renders, not a tabpanel.
      aria-pressed={selected}
      onClick={() => onSelect(channel)}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
        "hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-primary/60 ring-1 ring-primary/30",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <SvglLogo search={meta.search} fallback={meta.label} size={20} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="truncate text-sm font-semibold">{channel.name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {channelTargetHint(channel.kind, channel.target)}
          </div>
        </div>
        <span
          className={cn(
            "mt-1 size-1.5 shrink-0 rounded-full",
            broken
              ? "bg-destructive"
              : paused
                ? "bg-muted-foreground"
                : unrouted
                  ? "bg-amber-500"
                  : "bg-emerald-500",
          )}
          // The dot repeats what the footer says in words; the words are the
          // accessible name, so the dot stays out of the tree.
          aria-hidden
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <CoverageStrip subscribed={subscribed} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {unrouted ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
            {t("notifications.unrouted")}
          </span>
        ) : (
          <span>
            <b className="font-medium text-foreground">
              {routed}/{SUBSCRIBABLE_EVENTS.length}
            </b>{" "}
            {t("notifications.routedOf")}
          </span>
        )}
        {/* The delivery reading keeps its hover breakdown (failures in the last
            day, last delivery, status, degraded note) rather than being
            flattened back into a bare count — see channel-head-stats.tsx. */}
        <ChannelHeadStats channel={channel} />
      </div>
    </button>
  );
}
