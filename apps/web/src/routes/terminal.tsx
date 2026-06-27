import { Activity, useEffect, useState } from "react";

import {
  Cancel01Icon,
  PlusSignIcon,
  ServerStack01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { OpenTerminalDialog } from "@/features/terminal/components/open-terminal-dialog";
import { TerminalSession } from "@/features/terminal/components/terminal-session";
import { type Session, type SessionSource, describeSource } from "@/features/terminal/types";
import {
  encodeSessionToken,
  sessionSourcesFromSearch,
  terminalSearchSchema,
} from "@/features/terminal/url";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/terminal")({
  component: RouteComponent,
  validateSearch: terminalSearchSchema,
});

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSession(source: SessionSource): Session {
  return { id: newId(), label: describeSource(source), source };
}

function RouteComponent() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  // Hydrate the initial session list from the URL exactly once. After mount,
  // `sessions` is the source of truth and the URL is a one-way reflection of
  // it (see the sync effect below). Subsequent search-param changes from
  // outside (manual edit, history back) are intentionally ignored to avoid
  // tearing live WebSocket sessions out from under the user — useState's
  // lazy initializer only fires on the first render.
  const [sessions, setSessions] = useState<Session[]>(() =>
    sessionSourcesFromSearch(search).map(makeSession),
  );
  const [activeId, setActiveId] = useState<string | null>(() => sessions[0]?.id ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Mirror the current session list back into the URL so reload / share
  // restores every tab. `replace: true` keeps this out of the back-history
  // — every keystroke that adds a tab shouldn't create a new history entry.
  useEffect(() => {
    const tokens = sessions.map((s) => encodeSessionToken(s.source));
    void navigate({
      search: (prev) => ({
        ...prev,
        session: tokens.length > 0 ? tokens : undefined,
      }),
      replace: true,
    });
  }, [sessions, navigate]);

  function openSession(source: SessionSource) {
    const next = makeSession(source);
    setSessions((prev) => [...prev, next]);
    setActiveId(next.id);
  }

  function closeSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? (next[next.length - 1]?.id ?? null) : null);
      }
      return next;
    });
  }

  function close() {
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/" });
  }

  return (
    <div className="flex h-svh w-full flex-col bg-[oklch(0.12_0_0)] text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 bg-card/40 px-2 backdrop-blur">
        <div className="flex shrink-0 items-center gap-1.5 pl-1">
          <HugeiconsIcon
            icon={ServerStack01Icon}
            strokeWidth={1.8}
            className="size-4 text-muted-foreground"
          />
          <span className="text-[13px] font-medium">Terminal</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            · {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>

        {sessions.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px shrink-0 bg-border/60" aria-hidden />
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {sessions.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex shrink-0 items-center gap-1.5 rounded-md border transition-colors",
                      isActive
                        ? "border-border bg-background"
                        : "border-transparent hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(s.id)}
                      className="flex items-center gap-1.5 py-0.5 pl-2 font-mono text-[12px]"
                    >
                      <HugeiconsIcon
                        icon={TerminalIcon}
                        strokeWidth={2}
                        className="size-3 text-muted-foreground"
                      />
                      {s.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeSession(s.id)}
                      aria-label={`Close ${s.label}`}
                      className="grid size-5 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close terminal"
            onClick={close}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </header>

      {sessions.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <HugeiconsIcon
              icon={TerminalIcon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No active sessions</EmptyTitle>
            <EmptyDescription>
              Open a shell into any container, an SSH into a swarm node, or a database console.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setPickerOpen(true)}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
              Open a terminal
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <SessionPanels sessions={sessions} activeId={activeId} />
      )}

      <OpenTerminalDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={openSession} />
    </div>
  );
}

function SessionPanels({ sessions, activeId }: { sessions: Session[]; activeId: string | null }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[oklch(0.12_0_0)] p-2">
      {sessions.map((s) => {
        const isActive = s.id === activeId;
        // <Activity> keeps every session's React tree mounted across
        // tab switches — state (useState/useRef) is preserved, effects
        // re-attach cleanly on visibility flip, and we never tear down
        // the wterm <Terminal> instance.
        return (
          <Activity key={s.id} mode={isActive ? "visible" : "hidden"} name={s.label}>
            <div className="absolute inset-2" aria-hidden={!isActive}>
              <TerminalSession source={s.source} active={isActive} />
            </div>
          </Activity>
        );
      })}
    </div>
  );
}
