/**
 * Event → channel routing grid. Rows are events (with a severity dot),
 * columns are channels; each cell is a Switch that toggles whether that event
 * delivers to that channel. Column headers carry the channel's identity —
 * name, kind mark, and a short destination hint — so the grid reads as
 * "which events → which destination", not just "which kind". Backed by the
 * server subscription matrix; paused / disconnected channels render disabled.
 */
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Switch } from "@/shared/components/ui/switch";

import { type Channel, EVENTS, KIND_META, SEVERITY_DOT, channelTargetHint } from "./shared";

interface SubscriptionMatrixProps {
  channels: Channel[];
  /** channelId → set of subscribed event ids. */
  subs: Record<string, Set<string>>;
  onToggle: (channelId: string, eventId: string, enabled: boolean) => void;
}

export function SubscriptionMatrix({ channels, subs, onToggle }: SubscriptionMatrixProps) {
  const gridCols = `minmax(0,1fr) 90px repeat(${channels.length}, minmax(110px, 1fr))`;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight">Event subscription matrix</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Toggle which events deliver to which channel.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        {/* Header */}
        <div
          className="grid items-start gap-2 border-b bg-muted/50 px-3.5 py-2.5 text-[11px] tracking-wider text-muted-foreground uppercase"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span>Event</span>
          <span>Severity</span>
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
                  <span className="font-mono text-foreground/80">{c.events7d}</span> sent · 7d
                </span>
              </span>
            </span>
          ))}
        </div>

        {/* Rows */}
        {EVENTS.map((ev, i) => (
          <div
            key={ev.id}
            className="grid items-center gap-2 px-3.5 py-2.5 text-[12px]"
            style={{
              gridTemplateColumns: gridCols,
              borderTop: i > 0 ? "1px solid var(--border)" : undefined,
            }}
          >
            <span className="text-foreground">{ev.label}</span>
            <span className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${SEVERITY_DOT[ev.severity]}`} />
              <span className="font-mono text-[10px] text-muted-foreground">{ev.severity}</span>
            </span>
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
                    aria-label={`${ev.label} → ${KIND_META[c.kind].label}`}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
