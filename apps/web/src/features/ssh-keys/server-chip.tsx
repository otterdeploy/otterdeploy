/**
 * A server a key signs in to: its name, its live state as a dot (or an alert
 * icon when it's down), linking to that server. The tooltip says the role and
 * the state in words, so the state never rides on colour alone.
 */

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import type { KeyServer } from "./data/use-key-servers";

const DOT = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
  accent: "bg-primary",
} as const;

/** The state mark: a dot, or an alert icon for a server that's down. */
export function ServerStateMark({
  server,
  size = "sm",
}: {
  server: KeyServer;
  size?: "sm" | "md";
}) {
  const tone = server.state?.tone ?? "muted";
  if (tone === "bad") {
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        className={cn("shrink-0 text-destructive", size === "sm" ? "size-3" : "size-3.5")}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full", DOT[tone], size === "sm" ? "size-1.5" : "size-[7px]")}
    />
  );
}

function serverStateText(server: KeyServer): string {
  if (!server.state) return server.role;
  return `${server.role} · ${server.state.label.toLowerCase()}, ${server.state.detail}`;
}

export function ServerChip({ server }: { server: KeyServer }) {
  const { orgSlug } = useParams({ from: "/_app/$orgSlug" });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/$orgSlug/servers/$serverId"
            params={{ orgSlug, serverId: server.serverId }}
            className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-muted px-2 text-[11.5px] ring-1 ring-foreground/10 transition-colors outline-none hover:bg-foreground/7 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ServerStateMark server={server} />
            <span className="font-mono">{server.name}</span>
            {server.state ? <span className="sr-only">, {server.state.label}</span> : null}
          </Link>
        }
      />
      <TooltipContent side="top">{serverStateText(server)}</TooltipContent>
    </Tooltip>
  );
}
