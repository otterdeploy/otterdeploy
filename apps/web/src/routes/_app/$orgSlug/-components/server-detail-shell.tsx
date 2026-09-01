/**
 * Logs and Terminal tabs.
 *
 * A host shell exists for the control-plane host (a local PTY, the same one
 * the Terminal page opens). For every other node it needs the node daemon
 * (docs/designs/otterd.md `exec`), which is not built, so the tab says so
 * instead of rendering a prompt that could never connect. Host-level logs
 * have no backing contract on any node yet and get the same treatment.
 */
import { lazy, Suspense } from "react";

import { Link } from "@tanstack/react-router";

import type { Server } from "@/features/servers/data/server";

import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { buttonVariants } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

// The terminal module loads the Ghostty WASM core at import time; keep that
// off the server page until someone actually opens the tab.
const TerminalSession = lazy(() =>
  import("@/features/terminal/components/terminal-session").then((m) => ({
    default: m.TerminalSession,
  })),
);

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ServerLogsTab({ server }: { server: Server }) {
  return (
    <ComingSoon
      title="Host logs: coming soon"
      description={`Docker events, systemd journal and kernel messages for ${server.name} arrive with the node daemon. Service logs are on each service today.`}
    />
  );
}

export function ServerTerminalTab({ server, orgSlug }: { server: Server; orgSlug: string }) {
  if (!isControlPlaneRow(server)) {
    return (
      <ComingSoon
        title="Remote shell: coming soon"
        description={`A shell into ${server.name} needs the node daemon on the box. Today only the control-plane host has a shell here.`}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>Host shell on the control-plane machine. Every session is audited.</span>
        <Link
          to="/$orgSlug/terminal"
          params={{ orgSlug }}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7")}
        >
          Open in Terminal →
        </Link>
      </div>
      <div className="h-[60vh] min-h-[320px] overflow-hidden rounded-md ring-1 ring-foreground/10">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <TerminalSession
            source={{ kind: "ssh", mode: "local", node: server.name, host: server.host }}
            active
          />
        </Suspense>
      </div>
    </div>
  );
}
