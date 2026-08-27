/**
 * Event routing for ONE channel: the selected card's identity and actions, then
 * the subscribable catalog as a banded settings list.
 *
 * Replaces the event-subscription matrix. The matrix was a two-axis table whose
 * channel columns were fixed-width and right-aligned, so on a full-bleed page
 * with a single channel — the common case — "Deploy failed" sat at the left
 * gutter and its switch ~1800px away at the right edge, with nothing between
 * them. A control that far from its label is not a control, and no amount of
 * `scope="row"` fixes what the eye has to do. Routing is per-channel
 * configuration, so the channel owns it: label left, switch right, one capped
 * column apart.
 *
 * What the matrix genuinely did better was cross-channel comparison ("do both
 * #alerts and on-call get failures?"). That job moved to the coverage strip on
 * every channel card (channel-card.tsx), which answers it for all channels at
 * once and without a click, rather than for the two that happened to fit
 * on-screen.
 *
 * Rows are laid out in TWO columns from `md` up. Seventeen events in one column
 * is ~1200px of scrolling for a settings list; two columns fit the whole
 * catalog in roughly one screen, which is what makes "route all failures, mute
 * the rest" a single visual pass. Each band stays intact inside a column
 * (`break-inside-avoid`), so a band is never split across the fold.
 */

import { useTranslation } from "react-i18next";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import { ChannelActions, StatusPill } from "./channel-actions";
import { ChannelHeadStats } from "./channel-head-stats";
import {
  type Channel,
  EVENT_BANDS,
  type EventRow,
  KIND_META,
  SEVERITY_DOT,
  SEVERITY_GROUP_KEY,
  type Severity,
} from "./shared";

interface ToggleFn {
  (channelId: string, eventId: string, enabled: boolean): void;
}

function Band({
  channel,
  band,
  subscribed,
  onToggle,
  disabled,
}: {
  channel: Channel;
  band: { severity: Severity; events: readonly EventRow[] };
  subscribed: Set<string> | undefined;
  onToggle: ToggleFn;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const groupName = t(SEVERITY_GROUP_KEY[band.severity]);
  const on = band.events.filter((e) => subscribed?.has(e.id) ?? false).length;
  const all = on === band.events.length;

  return (
    // `max-w-xl` is the whole point of this rewrite: a settings row is a label
    // and its control, and the control has to stay next to the label. Without a
    // cap, a full-bleed page on a 1960px monitor stretches each column past
    // 900px and reintroduces exactly the stranded switch the matrix had. Extra
    // width becomes gutter.
    <section aria-label={groupName} className="max-w-xl break-inside-avoid pb-3 last:pb-0">
      <div className="flex items-center justify-between gap-3 pb-0.5">
        <h3 className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[band.severity])} />
          <span className="text-xs font-medium">{groupName}</span>
          <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
            {on}/{band.events.length}
          </span>
        </h3>
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
          disabled={disabled}
          // All on → clear the band; anything else → fill it. "Some on" filling
          // rather than clearing means a half-configured band is one click from
          // complete, which is the direction people actually want.
          onClick={() => {
            for (const e of band.events) {
              if ((subscribed?.has(e.id) ?? false) !== !all) onToggle(channel.id, e.id, !all);
            }
          }}
          aria-label={t("notifications.toggleGroup", { group: groupName, channel: channel.name })}
        >
          {all ? t("notifications.clearBand") : t("notifications.routeAll")}
        </Button>
      </div>

      {band.events.map((ev) => {
        // `<label htmlFor>` on the switch: `button` is a labelable element, so
        // this both names the control and makes the whole row a click target,
        // which is what a settings row should be.
        const id = `sub-${channel.id}-${ev.id}`;
        return (
          <label
            key={ev.id}
            htmlFor={id}
            className={cn(
              "flex items-center justify-between gap-4 rounded-md py-1.5 pr-2 pl-5 transition-colors",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent/40",
            )}
          >
            <span className="text-[13px]">{ev.label}</span>
            <Switch
              id={id}
              size="sm"
              checked={subscribed?.has(ev.id) ?? false}
              disabled={disabled}
              onCheckedChange={(next) => onToggle(channel.id, ev.id, next)}
            />
          </label>
        );
      })}
    </section>
  );
}

export function RoutingPanel({
  channel,
  subscribed,
  onToggle,
  onEdit,
  onViewDeliveries,
}: {
  channel: Channel;
  /** Event ids this channel is subscribed to. */
  subscribed: Set<string> | undefined;
  onToggle: ToggleFn;
  onEdit: (c: Channel) => void;
  onViewDeliveries: (c: Channel) => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[channel.kind];
  // A disconnected channel can't deliver, so its toggles are inert rather than
  // silently accepting routing that will never fire.
  const disabled = channel.status === "disconnected";

  const routeFailures = () => {
    const failures = EVENT_BANDS.find((b) => b.severity === "err");
    for (const e of failures?.events ?? []) {
      if (!(subscribed?.has(e.id) ?? false)) onToggle(channel.id, e.id, true);
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-start gap-3 border-b p-4">
        <SvglLogo search={meta.search} fallback={meta.label} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              {t("notifications.deliveredTo", { channel: channel.name })}
            </h2>
            <StatusPill status={channel.status} />
          </div>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
            {channel.target}
          </div>
          {/* One delivery reading with its hover breakdown, rather than three
              flat spans restating what the tooltip already answers in full
              (failures in the last day, last delivery, status, degraded note).
              See channel-head-stats.tsx. */}
          <div className="mt-1">
            <ChannelHeadStats channel={channel} />
          </div>
        </div>
        <ChannelActions channel={channel} onEdit={onEdit} onViewDeliveries={onViewDeliveries} />
      </header>

      {/* A channel routing nothing delivers nothing. Say so, and offer the one
          subscription almost everyone wants, rather than leaving seventeen
          switches off with no explanation. */}
      {!disabled && (subscribed?.size ?? 0) === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-500/5 px-4 py-2.5">
          <span className="text-[12.5px] text-muted-foreground">
            {t("notifications.nothingRouted")}
          </span>
          <Button size="xs" variant="outline" onClick={routeFailures}>
            {t("notifications.routeFailures")}
          </Button>
        </div>
      )}

      <div className="grid gap-x-8 p-4 md:grid-cols-2">
        {EVENT_BANDS.map((band) => (
          <Band
            key={band.severity}
            channel={channel}
            band={band}
            subscribed={subscribed}
            onToggle={onToggle}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
