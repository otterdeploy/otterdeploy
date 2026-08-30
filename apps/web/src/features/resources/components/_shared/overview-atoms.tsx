/**
 * The pieces every kind's Overview is built from: the state banner (dot, word,
 * why, and the one action that follows from it), a stat tile, and a log tail.
 * Shared so a stack, a service and a database land on the same shape, and so
 * an Overview is CONTENT: what is this, what state is it in, what happened
 * last, what is it saying, rather than a hub of links to the other tabs.
 */

import { useEffect, useState } from "react";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { ResourceState } from "@/features/resources/lib/resource-state";

import { useProjectLogStream } from "@/features/logs/data/use-project-log-stream";
import { TONE_DOT, TONE_TEXT } from "@/features/resources/lib/resource-state";
import { relativeSeconds } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

/** Coarse relative timestamp, re-rendered on a 30s tick so it stays honest.
 *  `now` is passed rather than read so the tick, not Date.now(), decides when
 *  the string changes. */
export function relativeTime(iso: string, now: number): string {
  return relativeSeconds((new Date(iso).getTime() - now) / 1000);
}

export function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * The state, said once, at the top. The word and the why are the same ones the
 * header pill shows; the banner adds the action that follows from the state
 * (a crashed service wants its logs, a building one wants its build).
 */
export function StateBanner({
  state,
  action,
}: {
  state: ResourceState | null;
  action?: { label: string; onClick: () => void } | null;
}) {
  if (!state) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2.5 text-[13px]">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[state.tone])} />
      <span className={cn("shrink-0 font-medium", TONE_TEXT[state.tone])}>{state.label}</span>
      {state.why && (
        <span className="min-w-0 truncate text-muted-foreground" title={state.why}>
          {state.why}
        </span>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-foreground/80 hover:text-foreground"
        >
          {action.label}
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
        </button>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  mono = false,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5">
      <span className="text-[10.5px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
        {label}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[13px] font-medium",
          mono && "font-mono text-[12.5px]",
          valueClass,
        )}
      >
        <span className="truncate" title={value}>
          {value}
        </span>
      </span>
      {sub && (
        <span className="truncate text-[11px] text-muted-foreground" title={sub}>
          {sub}
        </span>
      )}
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground/70 uppercase">
      {children}
    </div>
  );
}

/**
 * The last few lines the resource wrote, so "what is it saying" is answered on
 * the Overview without opening Logs. A shallow buffer on the same stream the
 * Logs tab uses; the tab itself keeps its own deeper one.
 */
export function LogTail({
  projectId,
  resourceIds,
  onOpenLogs,
  lines: count = 4,
}: {
  projectId: string;
  resourceIds: string[];
  onOpenLogs: () => void;
  lines?: number;
}) {
  const { lines } = useProjectLogStream({ projectId, resourceIds, paused: false, bufferSize: 60 });
  const tail = lines.filter((l) => l.stream !== "system").slice(-count);
  return (
    <div>
      <SectionHeading>Log tail</SectionHeading>
      <div className="mt-2 rounded-md border bg-card px-3 py-2 font-mono text-[11.5px] leading-[1.7]">
        {tail.length === 0 ? (
          <div className="text-muted-foreground">Nothing written yet.</div>
        ) : (
          tail.map((l) => (
            <div key={l.id} className="flex min-w-0 gap-2">
              {resourceIds.length > 1 && (
                <span className="shrink-0 text-muted-foreground/70">{l.svc}</span>
              )}
              {l.ts && <span className="shrink-0 text-muted-foreground/70">{l.ts}</span>}
              <span
                className={cn(
                  "min-w-0 truncate",
                  l.level === "error" ? "text-destructive/90" : "text-foreground/85",
                )}
                title={l.msg}
              >
                {l.msg}
              </span>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={onOpenLogs}
          className="mt-1.5 inline-flex items-center gap-1 font-sans text-[11.5px] font-medium text-foreground/80 hover:text-foreground"
        >
          Open logs
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
        </button>
      </div>
    </div>
  );
}
