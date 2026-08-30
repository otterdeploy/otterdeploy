/**
 * The Firewall's title row: what this is, whether the agent is answering, and
 * every action the view offers.
 *
 * The actions live HERE rather than in the toolbar below because they are the
 * one thing that must not move. Block and Refresh used to sit on the tab strip
 * and appear only on the Decisions tab, while the Flagged tab grew its own
 * mass-block button on a second row further down — so the button you were
 * reaching for was in a different place depending on where you had just been.
 */
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

export function FirewallHeader({
  configured,
  reachable,
  children,
}: {
  configured: boolean;
  reachable: boolean;
  /** The action buttons, right-aligned on the title row. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-base font-semibold">{t("firewall.title")}</h1>
        {reachable ? (
          <StatusPill tone="success">LAPI reachable</StatusPill>
        ) : configured ? (
          <StatusPill tone="destructive">LAPI unreachable</StatusPill>
        ) : (
          <StatusPill tone="muted">disabled</StatusPill>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
      {/* One line, and only where there is room for it. The old copy ran to two
          sentences above every tab and was read exactly once. */}
      <p className="hidden basis-full text-[13px] text-muted-foreground xl:block">
        CrowdSec watches your SSH auth log and Caddy&apos;s access log, then bans what it
        doesn&apos;t like — at the host firewall and at the edge, before the auth wall.
      </p>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "destructive" | "muted";
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap",
        tone === "success" && "text-success",
        tone === "destructive" && "text-destructive",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "success" && "animate-pulse bg-success",
          tone === "destructive" && "bg-destructive",
          tone === "muted" && "bg-muted-foreground",
        )}
      />
      {children}
    </span>
  );
}
