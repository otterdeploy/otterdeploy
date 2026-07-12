import { Maximize01Icon, PlusSignIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, useMemo, useState } from "react";

import { OpenTerminalDialog } from "@/features/terminal/components/open-terminal-dialog";
import { SessionTab } from "@/features/terminal/components/session-tab";
import {
  TerminalSession,
  type ConnState,
} from "@/features/terminal/components/terminal-session";
import {
  type Session,
  type SessionSource,
  describeSource,
} from "@/features/terminal/types";
import { sessionSourcesToSearchParams } from "@/features/terminal/url";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/_app/$orgSlug/_shell/terminal")({
  staticData: { crumb: "Terminal" },
  component: RouteComponent,
});

function RouteComponent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Per-session connection state, fed by each TerminalSession's onConnChange —
  // drives the status dot on the tab strip.
  const [connStates, setConnStates] = useState<Record<string, ConnState>>({});

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  function openSession(source: SessionSource) {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: Session = { id, label: describeSource(source), source };
    setSessions((prev) => [...prev, next]);
    setActiveId(id);
  }

  function closeSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? (next[next.length - 1]?.id ?? null) : null);
      }
      return next;
    });
    setConnStates(({ [id]: _closed, ...rest }) => rest);
  }

  function popoutActive() {
    if (!activeSession) return;
    const params = sessionSourcesToSearchParams([activeSession.source]);
    window.open(`/terminal?${params.toString()}`, "_blank", "noopener");
  }

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0 min-w-0 flex-col gap-3 overflow-hidden p-4">
      {/* Single-row header: title chunk · tab strip · actions */}
      <header className="flex h-9 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <HugeiconsIcon
            icon={TerminalIcon}
            strokeWidth={1.8}
            className="size-4 text-muted-foreground"
          />
          <span className="text-[13px] font-semibold">Terminal</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            · {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>

        {sessions.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px shrink-0 bg-border/60" aria-hidden />
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {sessions.map((s) => (
                <SessionTab
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  conn={connStates[s.id]}
                  onSelect={() => setActiveId(s.id)}
                  onClose={() => closeSession(s.id)}
                />
              ))}
            </div>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            aria-label="Pop out to fullscreen"
            disabled={!activeSession}
            onClick={popoutActive}
          >
            <HugeiconsIcon icon={Maximize01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            onClick={() => setPickerOpen(true)}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3" />
            New session
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden rounded-md",
          sessions.length === 0
            ? "border border-dashed border-border bg-muted/10"
            : "border bg-card",
        )}
      >
        {sessions.length === 0 ? (
          <EmptyState onOpen={() => setPickerOpen(true)} />
        ) : (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[oklch(0.12_0_0)] p-2">
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              // <Activity> keeps every session's React tree mounted across
              // tab switches — state (useState/useRef) is preserved, the
              // WebSocket effect re-attaches cleanly on visibility flip, and
              // we never tear down the wterm <Terminal> instance.
              return (
                <Activity
                  key={s.id}
                  mode={isActive ? "visible" : "hidden"}
                  name={s.label}
                >
                  <div className="absolute inset-2" aria-hidden={!isActive}>
                    <TerminalSession
                      source={s.source}
                      active={isActive}
                      onConnChange={(conn) =>
                        setConnStates((prev) => ({ ...prev, [s.id]: conn }))
                      }
                    />
                  </div>
                </Activity>
              );
            })}
          </div>
        )}
      </div>

      <OpenTerminalDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={openSession}
      />
    </div>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <Empty className="flex-1 border-none bg-transparent">
      <EmptyHeader>
        <HugeiconsIcon
          icon={TerminalIcon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>No active sessions</EmptyTitle>
        <EmptyDescription>
          Open a shell into any container, an SSH into a swarm node, or a
          database console. Multiple sessions stay live as separate tabs.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="sm" className="gap-1.5" onClick={onOpen}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Open a terminal
        </Button>
      </EmptyContent>
    </Empty>
  );
}
