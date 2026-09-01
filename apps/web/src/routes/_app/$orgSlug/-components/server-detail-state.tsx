/**
 * The server's state, said once and said the same way everywhere.
 *
 * `ServerStateBadge` is the ONLY badge a server carries: a tint of the
 * state's own hue, a dot and a word (DESIGN.md's State-Tint Rule; state
 * never depends on colour alone). Everything else about the box (role, last
 * report, engine version) is plain muted text beside it, never a second
 * chip competing for the eye. `ServerStateBanner` is the body-level
 * explanation for states that need the operator to know something.
 */
import { Link } from "@tanstack/react-router";

import type { ServerState, ServerStateTone } from "@/features/servers/detail/server-state";
import type { Server } from "@/features/servers/data/server";

import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const BADGE: Record<ServerStateTone, string> = {
  good: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  bad: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  accent: "bg-info/10 text-info",
};

const DOT: Record<ServerStateTone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
  accent: "bg-info",
};

const TEXT: Record<ServerStateTone, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
  accent: "text-info",
};

const RING: Record<ServerStateTone, string> = {
  good: "ring-foreground/10",
  warn: "ring-warning/30 bg-warning/5",
  bad: "ring-destructive/30 bg-destructive/5",
  muted: "ring-foreground/10",
  accent: "ring-info/30 bg-info/5",
};

export function ServerStateBadge({ state, className }: { state: ServerState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-4xl px-2 text-xs font-medium",
        BADGE[state.tone],
        className,
      )}
      title={state.detail}
    >
      <span className={cn("size-1.5 rounded-full", DOT[state.tone])} aria-hidden />
      {state.label}
    </span>
  );
}

interface BannerCopy {
  title: string;
  body: string;
  action?: { label: string; tab: "services" | "settings" };
}

function bannerCopy(state: ServerState, server: Server, tasks: number | null): BannerCopy | null {
  const placed =
    tasks === null ? "Anything placed here" : `${tasks} task${tasks === 1 ? "" : "s"} placed here`;
  switch (state.kind) {
    case "down":
      return {
        title: `${server.name} is down: ${state.detail}`,
        body: `${placed} ${tasks === 1 ? "is" : "are"} unreachable. If the box is gone, move its work; if it is rebooting, wait: the state clears itself when it reports again.`,
        action: { label: "Services", tab: "services" },
      };
    case "stale":
      return {
        title: `${server.name} missed its recent reports: ${state.detail}`,
        body: "The readings below are from that last report and are shown greyed. The box may be under load, or its clock may be skewed.",
      };
    case "unreported":
      return {
        title: `No health report from ${server.name} yet`,
        body: "Remote nodes report once the health agent reaches them. Until then this page shows what was registered, not what the box is doing.",
      };
    case "paused":
      return {
        title: "Scheduling is paused",
        body: "Existing tasks keep running and the box keeps reporting, but nothing new is placed here until you set it back to active.",
        action: { label: "Settings", tab: "settings" },
      };
    case "draining":
      return {
        title: "Draining",
        body: "Tasks are being moved off this box. Nothing new is placed here until you set it back to active.",
        action: { label: "Settings", tab: "settings" },
      };
    case "provisioning":
      return {
        title: `Provisioning: ${state.detail}`,
        body: "The install is still running on this host. Health and placement appear once it joins.",
      };
    case "failed":
      return { title: "Provisioning failed", body: state.detail };
    default:
      return null;
  }
}

export function ServerStateBanner({
  state,
  server,
  tasks,
  orgSlug,
}: {
  state: ServerState;
  server: Server;
  tasks: number | null;
  orgSlug: string;
}) {
  const copy = bannerCopy(state, server, tasks);
  if (!copy) return null;
  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-start gap-3 rounded-md px-4 py-3 ring-1", RING[state.tone])}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[state.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn("text-[13px] font-medium", TEXT[state.tone])}>{copy.title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
      </div>
      {copy.action && (
        <Link
          to="/$orgSlug/servers/$serverId"
          params={{ orgSlug, serverId: server.id }}
          search={{ tab: copy.action.tab }}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 self-center")}
        >
          {copy.action.label}
        </Link>
      )}
    </div>
  );
}
