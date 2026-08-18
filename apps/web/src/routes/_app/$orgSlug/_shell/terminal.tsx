import { Maximize01Icon, PlusSignIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { useState } from "react";

import { serverCollection } from "@/features/servers/data/server";
import { OpenTerminalDialog } from "@/features/terminal/components/open-terminal-dialog";
import { SessionPanels } from "@/features/terminal/components/session-panels";
import { SessionStrip } from "@/features/terminal/components/session-strip";
import {
  terminalContainersCollection,
  terminalDatabasesCollection,
} from "@/features/terminal/data/targets";
import { sessionSourcesToSearchParams, terminalSearchSchema } from "@/features/terminal/url";
import { useTerminalSessions } from "@/features/terminal/use-terminal-sessions";
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
  validateSearch: terminalSearchSchema,
  // The schema's `session` transform always outputs an array (`[]` when
  // absent), so a fresh visit's sync-to-URL effect would otherwise write a
  // literal `?session=%5B%5D`: strip it back off when it's the empty default.
  search: { middlewares: [stripSearchParams({ session: [] })] },
  // Warm the "New session" picker's data on hover (intent-preload): the two
  // target collections share one terminal.targets RPC (deduped in targets.ts),
  // plus the org server list. targets scans live docker state, so it is never
  // awaited: best-effort only; the picker falls back to fetch-on-open.
  loader: () => {
    void terminalContainersCollection.preload().catch(() => undefined);
    void terminalDatabasesCollection.preload().catch(() => undefined);
    void serverCollection.preload().catch(() => undefined);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Sessions live in the URL (`?session=…&active=…`) so a reload, a share, or
  // a pop-out carries the whole strip. `replace: true` keeps opening a tab out
  // of the back-history.
  const term = useTerminalSessions(search, (next) => {
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  });

  function popoutActive() {
    if (!term.activeSession) return;
    const params = sessionSourcesToSearchParams([term.activeSession.source]);
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
            · {term.sessions.length}{" "}
            {term.sessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>

        <SessionStrip
          sessions={term.sessions}
          activeId={term.activeId}
          connStates={term.connStates}
          onSelect={term.select}
          onClose={term.close}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            aria-label="Pop out to fullscreen"
            disabled={!term.activeSession}
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
          term.sessions.length === 0
            ? "border border-dashed border-border bg-muted/10"
            : "border bg-card",
        )}
      >
        {term.sessions.length === 0 ? (
          <EmptyState onOpen={() => setPickerOpen(true)} />
        ) : (
          <SessionPanels
            sessions={term.sessions}
            activeId={term.activeId}
            onConnChange={term.setConn}
          />
        )}
      </div>

      <OpenTerminalDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={term.open}
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
