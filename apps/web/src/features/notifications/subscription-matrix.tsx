import { useTranslation } from "react-i18next";

/**
 * Event → channel routing grid. Rows are events, columns are channels; each
 * cell is a Switch that toggles whether that event delivers to that channel.
 * Column headers carry the channel's identity — name, kind mark, and a short
 * destination hint — so the grid reads as "which events → which destination",
 * not just "which kind". Backed by the server subscription matrix; paused /
 * disconnected channels render disabled.
 *
 * Rows are GROUPED BY SEVERITY, worst-first, on the same rank order the bell
 * badge uses (shared.ts). Two reasons this beats one flat list of eighteen:
 *
 *   - Severity stops being a column. It was a static property of the event,
 *     never something you configure, so it spent a whole column restating
 *     what a dot already said. As a group header it costs one row per band
 *     instead of eighteen cells, and the dead horizontal space it was holding
 *     open collapses.
 *   - Subscribing is a severity-shaped decision. Nobody wants "deploy.failed
 *     and backup.failed and build.failed" — they want "page me on failures,
 *     stay quiet otherwise". The group header's counter makes that one click
 *     per band per channel instead of eighteen.
 *
 * The channel columns are fixed-width and sit hard right, so with a single
 * channel the grid reads as an ordinary settings list (label left, control
 * right) rather than one lonely switch stranded mid-row.
 */
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Switch } from "@/shared/components/ui/switch";

import {
  type Channel,
  KIND_META,
  SEVERITY_DOT,
  SUBSCRIBABLE_EVENTS,
  type Severity,
  channelTargetHint,
} from "./shared";

interface SubscriptionMatrixProps {
  channels: Channel[];
  /** channelId → set of subscribed event ids. */
  subs: Record<string, Set<string>>;
  onToggle: (channelId: string, eventId: string, enabled: boolean) => void;
}

/** Worst-first, matching SEVERITY_RANK in shared.ts: a failure band is never
 *  buried under the successes band. */
const SEVERITY_ORDER: readonly Severity[] = ["err", "warn", "info", "ok"];

/** i18n key per band. Named for what the band MEANS to an operator deciding
 *  whether to be woken up, not for the enum value. */
const SEVERITY_GROUP_KEY = {
  err: "notifications.groupErr",
  warn: "notifications.groupWarn",
  info: "notifications.groupInfo",
  ok: "notifications.groupOk",
  // `as const` keeps these as literal types: `t()` takes a union of known key
  // paths, and a widened `string` fails to match it.
} as const satisfies Record<Severity, string>;

const GROUPS = SEVERITY_ORDER.map((severity) => ({
  severity,
  events: SUBSCRIBABLE_EVENTS.filter((e) => e.severity === severity),
})).filter((g) => g.events.length > 0);

export function SubscriptionMatrix({ channels, subs, onToggle }: SubscriptionMatrixProps) {
  const { t } = useTranslation();
  // Event label flexes; channel columns are a fixed width pinned to the right
  // edge. `1fr` on the channels was what opened the gap in the first place.
  const gridCols = `minmax(0,1fr) repeat(${channels.length}, 148px)`;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight">
          {t("notifications.matrixTitle")}
        </h2>
        <p className="text-[12.5px] text-muted-foreground">
          {t("notifications.matrixHint")}
        </p>
      </div>

      {/* overflow-x-auto, not overflow-hidden: this is a genuine 2-D matrix
          (events × channels): it is the one shape on the page that cannot
          stack into a list without losing the relationship it exists to show,
          so on a phone it scrolls sideways instead of silently clipping the
          right-hand channels. The min-width keeps the columns legible rather
          than crushing switches together. */}
      <div className="overflow-x-auto rounded-md border bg-card">
        {/* Header */}
        <div
          className="grid min-w-[460px] items-end gap-2 border-b bg-muted/50 px-3.5 py-2.5 text-[11px] tracking-wider text-muted-foreground uppercase"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span>{t("notifications.event")}</span>
          {channels.map((c) => (
            <span key={c.id} className="flex min-w-0 items-start gap-2">
              <SvglLogo
                search={KIND_META[c.kind].search}
                fallback={KIND_META[c.kind].label}
                size={18}
              />
              <span className="flex min-w-0 flex-col gap-0.5 tracking-normal normal-case">
                <span className="truncate text-[11px] font-medium text-foreground" title={c.name}>
                  {c.name}
                </span>
                <span
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={c.target}
                >
                  {channelTargetHint(c.kind, c.target)}
                </span>
                <span className="text-[10px] text-muted-foreground/80">
                  <span className="font-mono text-foreground/80">{c.events7d}</span>{" "}
                  {t("notifications.sentIn7d")}
                </span>
              </span>
            </span>
          ))}
        </div>

        {GROUPS.map((group) => {
          const groupName = t(SEVERITY_GROUP_KEY[group.severity]);
          return (
            <div key={group.severity}>
              {/* Band header: carries the severity the column used to, plus a
                  per-channel counter that doubles as the bulk control. */}
              <div
                className="grid min-w-[460px] items-center gap-2 border-b bg-muted/25 px-3.5 py-1.5"
                style={{ gridTemplateColumns: gridCols }}
              >
                <span className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${SEVERITY_DOT[group.severity]}`} />
                  <span className="text-[11px] font-medium tracking-wider text-foreground uppercase">
                    {groupName}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {group.events.length}
                  </span>
                </span>
                {channels.map((c) => {
                  const set = subs[c.id];
                  const on = group.events.filter((e) => set?.has(e.id) ?? false).length;
                  const all = on === group.events.length;
                  const disabled = c.status === "disconnected";
                  return (
                    <span key={c.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        // All on → clear the band; anything else → fill it.
                        // "Some on" filling rather than clearing means a
                        // half-configured band is one click from complete,
                        // which is the direction people actually want.
                        onClick={() => {
                          for (const e of group.events) {
                            const isOn = set?.has(e.id) ?? false;
                            if (isOn !== !all) onToggle(c.id, e.id, !all);
                          }
                        }}
                        className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t("notifications.toggleGroup", {
                          group: groupName,
                          channel: c.name,
                        })}
                      >
                        {on}/{group.events.length}
                      </button>
                    </span>
                  );
                })}
              </div>

              {group.events.map((ev, i) => (
                <div
                  key={ev.id}
                  className="grid min-w-[460px] items-center gap-2 px-3.5 py-2 text-[12.5px]"
                  style={{
                    gridTemplateColumns: gridCols,
                    borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  }}
                >
                  <span className="text-foreground">{ev.label}</span>
                  {channels.map((c) => {
                    const on = subs[c.id]?.has(ev.id) ?? false;
                    const disabled = c.status === "disconnected";
                    return (
                      <span key={c.id}>
                        <Switch
                          size="sm"
                          checked={on}
                          disabled={disabled}
                          onCheckedChange={(next) => onToggle(c.id, ev.id, next)}
                          aria-label={`${ev.label} → ${c.name}`}
                        />
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
