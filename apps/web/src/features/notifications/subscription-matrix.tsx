import { useId } from "react";

import { useTranslation } from "react-i18next";

/**
 * Event → channel routing grid.
 *
 * Built on the shared Table primitives (shared/components/ui/table), because
 * this is a two-axis matrix whose cells are meaningless without both headers.
 * A switch announced on its own says "off" — the operator needs "Deploy
 * failed, #alerts, off". `TableHead` carries `scope="col"` for channels and
 * `scope="row"` for the event name, and each severity band is its own
 * `TableBody` headed by `scope="rowgroup"`, so screen readers get the whole
 * relationship from the semantics instead of from labels we remembered to
 * write. (The switches keep an explicit `aria-label` anyway: table-context
 * announcement varies across AT, and the name is what every one of them
 * reads.)
 *
 * Not the data-grid (shared/components/data-grid): that is the TanStack-backed
 * editable spreadsheet — cell variants, paste, presence — for the Postgres
 * viewer and logs. This is a fixed, hand-authored settings matrix with no
 * sorting, virtualization or column model, so the composed primitives are the
 * right altitude and the grid would be several hundred lines of machinery
 * around eighteen static rows.
 *
 * Rows are GROUPED BY SEVERITY, worst-first, on the same rank order the bell
 * badge uses (shared.ts). Two reasons this beats one flat list of eighteen:
 *
 *   - Severity stops being a column. It was a static property of the event,
 *     never something you configure, so it spent a whole column restating
 *     what a dot already said. As a rowgroup header it costs one row per band
 *     instead of eighteen cells, and the dead horizontal space it was holding
 *     open collapses.
 *   - Subscribing is a severity-shaped decision. Nobody wants "deploy.failed
 *     and backup.failed and build.failed" — they want "page me on failures,
 *     stay quiet otherwise". The band header's counter makes that one click
 *     per band per channel instead of eighteen.
 *
 * Channel columns are fixed-width, so with a single channel the table reads as
 * an ordinary settings list (label left, control right) rather than one lonely
 * switch stranded mid-row.
 */
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { ChannelHeadStats } from "./channel-head-stats";
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
  const titleId = useId();

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 id={titleId} className="text-[14px] font-semibold tracking-tight">
          {t("notifications.matrixTitle")}
        </h2>
        <p className="text-[12.5px] text-muted-foreground">{t("notifications.matrixHint")}</p>
      </div>

      {/* `Table` supplies the overflow-x-auto container: this is the one shape
          on the page that cannot stack into a list without losing the
          relationship it exists to show, so on a phone it scrolls sideways
          rather than silently clipping the right-hand channels. The min-width
          keeps columns legible instead of crushing switches together. */}
      <div className="rounded-md border bg-card">
        <Table aria-labelledby={titleId} className="min-w-[460px]">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead
                scope="col"
                className="px-3.5 py-2.5 text-[11px] tracking-wider text-muted-foreground uppercase"
              >
                {t("notifications.event")}
              </TableHead>
              {channels.map((c) => (
                <TableHead key={c.id} scope="col" className="w-[148px] px-3.5 py-2.5 font-normal">
                  <span className="flex min-w-0 items-start gap-2">
                    <SvglLogo
                      search={KIND_META[c.kind].search}
                      fallback={KIND_META[c.kind].label}
                      size={18}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[11px] font-medium" title={c.name}>
                        {c.name}
                      </span>
                      <span
                        className="truncate font-mono text-[10px] font-normal text-muted-foreground"
                        title={c.target}
                      >
                        {channelTargetHint(c.kind, c.target)}
                      </span>
                      <ChannelHeadStats channel={c} />
                    </span>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          {/* One TableBody per severity band: the semantic way to say "these
              rows are a group", which is what `scope="rowgroup"` then heads. */}
          {GROUPS.map((group) => {
            const groupName = t(SEVERITY_GROUP_KEY[group.severity]);
            return (
              <TableBody key={group.severity}>
                <TableRow className="bg-muted/25 hover:bg-muted/25">
                  <TableHead scope="rowgroup" className="h-auto px-3.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${SEVERITY_DOT[group.severity]}`} />
                      <span className="text-[11px] font-medium tracking-wider uppercase">
                        {groupName}
                      </span>
                      <span className="font-mono text-[10px] font-normal text-muted-foreground">
                        {group.events.length}
                      </span>
                    </span>
                  </TableHead>
                  {channels.map((c) => {
                    const set = subs[c.id];
                    const on = group.events.filter((e) => set?.has(e.id) ?? false).length;
                    const all = on === group.events.length;
                    const disabled = c.status === "disconnected";
                    return (
                      <TableCell key={c.id} className="px-3.5 py-1.5">
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
                      </TableCell>
                    );
                  })}
                </TableRow>

                {group.events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableHead
                      scope="row"
                      className="h-auto px-3.5 py-2 text-[12.5px] font-normal text-foreground"
                    >
                      {ev.label}
                    </TableHead>
                    {channels.map((c) => {
                      const on = subs[c.id]?.has(ev.id) ?? false;
                      const disabled = c.status === "disconnected";
                      return (
                        <TableCell key={c.id} className="px-3.5 py-2">
                          <Switch
                            size="sm"
                            checked={on}
                            disabled={disabled}
                            onCheckedChange={(next) => onToggle(c.id, ev.id, next)}
                            aria-label={`${ev.label} → ${c.name}`}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
