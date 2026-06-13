/**
 * Event → channel routing grid. Rows are events (with a severity dot),
 * columns are channels; each cell is a Switch that toggles whether that
 * event delivers to that channel. Disconnected channels render disabled.
 */

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Switch } from "@/shared/components/ui/switch";

import {
  type Channel,
  EVENTS,
  KIND_META,
  SEVERITY_DOT,
} from "./shared";

interface SubscriptionMatrixProps {
  channels: Channel[];
  subs: Record<string, Set<string>>;
  onToggle: (channelId: string, eventId: string) => void;
}

export function SubscriptionMatrix({
  channels,
  subs,
  onToggle,
}: SubscriptionMatrixProps) {
  const gridCols = `minmax(0,1fr) 90px repeat(${channels.length}, minmax(110px, 1fr))`;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight">
          Event subscription matrix
        </h2>
        <p className="text-[12.5px] text-muted-foreground">
          Toggle which events deliver to which channel.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        {/* Header */}
        <div
          className="grid items-center gap-2 border-b bg-muted/50 px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span>Event</span>
          <span>Severity</span>
          {channels.map((c) => (
            <span key={c.id} className="flex items-center gap-2">
              <SvglLogo search={KIND_META[c.kind].search} fallback={KIND_META[c.kind].label} size={18} />
              <span className="text-[11px] normal-case tracking-normal text-foreground">
                {KIND_META[c.kind].label}
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
              <span
                className={`size-2 rounded-full ${SEVERITY_DOT[ev.severity]}`}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {ev.severity}
              </span>
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
                    onCheckedChange={() => onToggle(c.id, ev.id)}
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
