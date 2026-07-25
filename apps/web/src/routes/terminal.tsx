import { useState } from "react";

import {
  Cancel01Icon,
  PlusSignIcon,
  ServerStack01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, stripSearchParams, useRouter } from "@tanstack/react-router";

import { OpenTerminalDialog } from "@/features/terminal/components/open-terminal-dialog";
import { SessionPanels } from "@/features/terminal/components/session-panels";
import { SessionStrip } from "@/features/terminal/components/session-strip";
import { terminalSearchSchema } from "@/features/terminal/url";
import { useTerminalSessions } from "@/features/terminal/use-terminal-sessions";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export const Route = createFileRoute("/terminal")({
  component: RouteComponent,
  validateSearch: terminalSearchSchema,
  // See routes/_app/$orgSlug/_shell/terminal.tsx — strips the noisy
  // `?session=%5B%5D` the schema's array-transform default would otherwise
  // write back on a fresh popout with no sessions yet.
  search: { middlewares: [stripSearchParams({ session: [] })] },
});

function RouteComponent() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [pickerOpen, setPickerOpen] = useState(false);

  const term = useTerminalSessions(search, (next) => {
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  });

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
            · {term.sessions.length} {term.sessions.length === 1 ? "session" : "sessions"}
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

      {term.sessions.length === 0 ? (
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
        <SessionPanels
          sessions={term.sessions}
          activeId={term.activeId}
          onConnChange={term.setConn}
        />
      )}

      <OpenTerminalDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={term.open} />
    </div>
  );
}
