/**
 * Live daemon event feed: the Events tab of the Docker panel.
 *
 * Opt-in: nothing streams until the operator clicks "Go live" (an event
 * firehose is a debugging tool, not ambient decoration), and "Stop" unmounts
 * the live view, which aborts the subscription. While live, it streams
 * `docker.events.stream` (the daemon's `/events` firehose, flattened
 * server-side) through the shared `useLogStream` ring buffer. Everything the
 * daemon reports is streamed; the type chips filter the CLIENT buffer only,
 * so toggling one never tears the stream or drops history. Nothing is
 * persisted anywhere: the server bridges the daemon bus straight to the
 * response, and this buffer is the only place events live.
 *
 * The list renders oldest→newest inside a fixed-height ScrollArea pinned to
 * the bottom, with the same follow contract as every other tail in the app:
 * scrolling up into history releases the pin, the shared JumpToLatest pill
 * re-pins.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { JumpToLatest } from "@/features/logs/components/jump-to-latest";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
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
 *  per container, so a busy daemon fills this in minutes: deep enough to
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
 *  event-specific facts: exitCode, signal, image, driver, container, … */
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
  // Subscribe-on-demand: the live view is a separate component so "Stop"
  // unmounts it, which is what aborts the stream (see useLogStream cleanup).
  const [live, setLive] = useState(false);
  if (!live) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md px-4 py-12 ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Live daemon events</p>
        <p className="max-w-md text-center text-xs leading-relaxed text-muted-foreground">
          Tails the daemon's event feed in real time: container lifecycles, health probes, network
          attaches. Nothing is stored — the feed exists only while you watch it.
        </p>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setLive(true)}>
          Go live
        </Button>
      </div>
    );
  }
  return <LiveEventsFeed onStop={() => setLive(false)} />;
}

/** Pin-to-bottom follow over the ScrollArea viewport (the hook owns the ref):
 *  scrolling up releases the pin, `resume` (the JumpToLatest pill) re-pins.
 *  Same contract as log-viewer.tsx, minus the virtualizer (500 rows max). */
function useFollow(lineCount: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      setFollowing((prev) => (atBottom === prev ? prev : atBottom));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!following || lineCount === 0) return;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [following, lineCount]);

  const resume = () => {
    setFollowing(true);
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  };
  return { viewportRef, following, resume };
}

function LiveEventsFeed({ onStop }: { onStop: () => void }) {
  const [paused, setPaused] = useState(false);
  // Hidden types rather than shown types, so "everything visible" is the
  // empty set and new event types default to visible.
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<EventType>>(new Set());

  const { lines, status } = useLogStream({
    // useLogStream owns reconnects (initial/backfill semantics don't apply -
    // the daemon feed has no replay), so no client retry context here.
    open: (signal) => orpc.docker.events.stream.call({}, { signal }),
    map: (ev, seq): EventLine => ({ id: seq, ...ev }),
    key: "docker-events",
    bufferSize: BUFFER_SIZE,
    paused,
  });

  // Relative timestamps drift while the feed is quiet or paused: tick a
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

  // Chronological (oldest → newest), pinned to the bottom like every other
  // tail in the app: "what just happened" is where the pin holds you.
  const visible = useMemo(
    () => (hiddenTypes.size ? lines.filter((line) => !hiddenTypes.has(line.type)) : lines),
    [lines, hiddenTypes],
  );

  const { viewportRef, following, resume } = useFollow(visible.length);

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
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>

      <div className="relative min-w-0">
        <ScrollArea
          className="h-[min(60vh,36rem)] rounded-md ring-1 ring-foreground/10"
          viewportRef={viewportRef}
        >
          {visible.length === 0 ? (
            <p className="grid h-full place-items-center text-sm text-muted-foreground">
              Waiting for events…
            </p>
          ) : (
            <div className="py-1">
              {visible.map((line) => (
                <EventRow key={line.id} line={line} />
              ))}
            </div>
          )}
        </ScrollArea>
        {!following && visible.length > 0 && <JumpToLatest onClick={resume} />}
      </div>
    </div>
  );
}
