/**
 * Live daemon event feed — the Events tab of the Raw Docker panel.
 *
 * Streams `docker.events.stream` (the daemon's `/events` firehose, flattened
 * server-side) through the shared `useLogStream` ring buffer. Everything the
 * daemon reports is streamed; the type chips filter the CLIENT buffer only,
 * so toggling one never tears the stream or drops history. The parent mounts
 * this component only while the tab is active — unmounting aborts the
 * subscription, so an idle panel holds no daemon connection.
 */
import { useEffect, useMemo, useReducer, useState } from "react";

import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { shortId, timeAgoSeconds } from "./docker-format";

const EVENT_TYPES = [
  "container",
  "service",
  "task",
  "network",
  "node",
  "image",
  "volume",
  "unknown",
] as const;
type EventType = (typeof EVENT_TYPES)[number];

interface EventLine {
  id: number;
  ts: number;
  type: EventType;
  action: string;
  actorId: string;
  actorName: string | null;
  attributes: Record<string, string>;
}

/** Scrollback depth. Healthcheck probes alone emit an exec_* triple per probe
 *  per container, so a busy daemon fills this in minutes — deep enough to
 *  read back through an incident, bounded so an open tab can't grow forever. */
const BUFFER_SIZE = 500;

/** Destructive-leaning daemon verbs get the destructive tint; lifecycle-up
 *  verbs the success tint; the rest stay neutral. Color is a hint on top of
 *  the verb text, never the only signal. */
function actionClass(action: string): string {
  if (action.startsWith("health_status")) {
    return action.includes("unhealthy") ? "text-destructive" : "text-success";
  }
  const verb = action.split(":")[0].trim();
  if (["die", "kill", "destroy", "delete", "remove", "oom", "disconnect", "untag"].includes(verb)) {
    return "text-destructive";
  }
  if (["start", "create", "pull", "connect"].includes(verb)) return "text-success";
  return "text-foreground";
}

/** Compact `k=v` summary of the actor attributes. Name is already the row's
 *  actor column and namespaced label keys (`com.docker.…`, `org.…`) are
 *  build metadata noise, so both are skipped; the survivors are the daemon's
 *  event-specific facts — exitCode, signal, image, driver, container, … */
function attributesSummary(attributes: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "name" || key.includes(".")) continue;
    const v = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    parts.push(`${key}=${v}`);
    if (parts.length === 4) break;
  }
  return parts.join(" ");
}

function EventRow({ line }: { line: EventLine }) {
  const summary = attributesSummary(line.attributes);
  const actor = line.actorName ?? shortId(line.actorId);
  return (
    <div className="flex items-baseline gap-3 whitespace-nowrap px-2 py-0.5 font-mono text-xs hover:bg-secondary/50">
      <span className="w-24 shrink-0 text-muted-foreground" title={new Date(line.ts).toISOString()}>
        {timeAgoSeconds(line.ts / 1000)}
      </span>
      <Badge
        variant="secondary"
        className="w-[4.75rem] shrink-0 justify-center rounded-sm px-1 font-mono text-[10px]"
      >
        {line.type}
      </Badge>
      <span className={cn("w-36 shrink-0 truncate", actionClass(line.action))} title={line.action}>
        {line.action}
      </span>
      <span className="max-w-64 truncate" title={line.actorId}>
        {actor}
      </span>
      {summary && (
        <span className="truncate text-muted-foreground" title={summary}>
          {summary}
        </span>
      )}
    </div>
  );
}

export function DockerEventsFeed() {
  const [paused, setPaused] = useState(false);
  // Hidden types rather than shown types, so "everything visible" is the
  // empty set and new event types default to visible.
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<EventType>>(new Set());

  const { lines, status } = useLogStream({
    // useLogStream owns reconnects (initial/backfill semantics don't apply —
    // the daemon feed has no replay), so no client retry context here.
    open: (signal) => orpc.docker.events.stream.call({}, { signal }),
    map: (ev, seq): EventLine => ({ id: seq, ...ev }),
    key: "docker-events",
    bufferSize: BUFFER_SIZE,
    paused,
  });

  // Relative timestamps drift while the feed is quiet or paused — tick a
  // re-render twice a minute so "5 seconds ago" can't sit there for an hour.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(() => {
    const byType = new Map<EventType, number>();
    for (const line of lines) byType.set(line.type, (byType.get(line.type) ?? 0) + 1);
    return byType;
  }, [lines]);

  // Newest first — an ops feed is read from "what just happened" downward.
  const visible = useMemo(() => {
    const filtered = hiddenTypes.size
      ? lines.filter((line) => !hiddenTypes.has(line.type))
      : lines;
    return filtered.toReversed();
  }, [lines, hiddenTypes]);

  const toggleType = (type: EventType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {EVENT_TYPES.map((type) => {
          const active = !hiddenTypes.has(type);
          const count = counts.get(type) ?? 0;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleType(type)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-sm px-2 font-mono text-[11px] ring-1 transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground ring-foreground/10"
                  : "text-muted-foreground/60 ring-foreground/10 line-through",
              )}
            >
              {type}
              {count > 0 && <span className="text-[10px] text-muted-foreground">{count}</span>}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {status === "connecting" && "connecting…"}
            {status === "live" && (paused ? "paused" : "live")}
            {status === "error" && "reconnecting…"}
            {status === "ended" && "disconnected"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-md ring-1 ring-foreground/10">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">Waiting for events…</p>
        ) : (
          <div className="py-1">
            {visible.map((line) => (
              <EventRow key={line.id} line={line} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
