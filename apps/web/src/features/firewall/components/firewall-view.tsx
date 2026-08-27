/**
 * Firewall view: CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge Logs page (an edge-level concern: cluster-wide / identity-blind, so
 * it sits beside Access + Events at the org scope). Follows the same full-height
 * instrument layout as those views: header + status pill, a hairline toolbar,
 * then a full-bleed table that fills the remaining height.
 */
import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { decisionsQuery, prefetchFirewall, statusQuery } from "../data";
import { BlockIpForm } from "./block-ip-form";
import { BlocklistsPanel } from "./blocklists-panel";
import { DecisionsTable, FirewallDisabledCard } from "./firewall-view-parts";
import { FlaggedPanel } from "./flagged-panel";
import { HistoryPanel } from "./history-panel";

type View = "decisions" | "history" | "flagged" | "sources";

export function FirewallView() {
  // Shared query options (see ../data): staleTime + keepPreviousData are what
  // stop a tab switch flashing an empty table before the rows arrive.
  const status = useQuery(statusQuery());
  const decisions = useQuery(decisionsQuery());
  const queryClient = useQueryClient();

  // Warm every tab on mount as well as in the route loader: a direct
  // navigation (paste a URL, reload) has no hover to preload from.
  useEffect(() => {
    prefetchFirewall(queryClient);
  }, [queryClient]);

  const s = status.data;
  const rows = decisions.data ?? [];
  const reachable = Boolean(s?.reachable);
  const configured = Boolean(s?.configured);
  // The firewall is usable whenever the agent answers over the Docker socket
  // (reachable) OR the bouncer env is set (configured). Decisions are read AND
  // written purely via `cscli` exec, independent of the CROWDSEC_* env, so a
  // running agent must surface its blocked IPs even when the server process
  // lacks those vars. Gating the Decisions view on `configured` alone hid every
  // blocked IP: a block from the edge landed in CrowdSec but never showed here.
  const usable = configured || reachable;
  const [view, setView] = useState<View>("decisions");

  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Blocked ${vars.ip}`);
        void decisions.refetch();
      } else {
        toast.error(r.error ?? "Block failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });
  const unblock = useMutation({
    ...orpc.firewall.unblock.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Unblocked ${vars.ip}`);
        void decisions.refetch();
      } else {
        toast.error(r.error ?? "Unblock failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Unblock failed"),
  });

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <FirewallHeader configured={configured} reachable={reachable} />
      <FirewallToolbar
        view={view}
        onViewChange={setView}
        usable={usable}
        decisionCount={rows.length}
        refreshing={decisions.isFetching}
        onRefresh={() => {
          void status.refetch();
          void decisions.refetch();
        }}
        onBlock={(ip, durationHours) => block.mutate({ ip, durationHours })}
        blocking={block.isPending}
      />

      {view === "sources" ? (
        <BlocklistsPanel />
      ) : view === "history" ? (
        <HistoryPanel />
      ) : view === "flagged" ? (
        <FlaggedPanel />
      ) : !usable ? (
        <FirewallDisabledCard />
      ) : (
        <DecisionsTable
          rows={rows}
          reachable={reachable}
          onUnblock={(ip) => unblock.mutate({ ip })}
          unblocking={unblock.isPending}
        />
      )}
    </div>
  );
}

function FirewallHeader({ configured, reachable }: { configured: boolean; reachable: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">{t("firewall.title")}</h1>
        {reachable ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success" />
            LAPI reachable
          </span>
        ) : configured ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            LAPI unreachable
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground" />
            disabled
          </span>
        )}
      </div>
      {/* The old line said "at the Caddy edge", which made an SSH ban look
          misfiled. CrowdSec watches the host's auth log AND Caddy's access
          log, and two different bouncers enforce what it decides. */}
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        CrowdSec watches your SSH auth log and Caddy's access log, then bans what it doesn't like —
        at the host firewall and at the edge. Identity-blind; runs before the auth wall.
      </p>
    </div>
  );
}

const TAB_LABEL: Record<View, string> = {
  decisions: "Enforcing now",
  history: "History",
  flagged: "Flagged IPs",
  sources: "Sources",
};

function FirewallToolbar({
  view,
  onViewChange,
  usable,
  decisionCount,
  refreshing,
  onRefresh,
  onBlock,
  blocking,
}: {
  view: View;
  onViewChange: (v: View) => void;
  usable: boolean;
  decisionCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onBlock: (ip: string, durationHours: number) => void;
  blocking: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {/* Ordered as the question an operator asks: what is blocked now →
            what has been blocked → who is probing → what we import. */}
        {(["decisions", "history", "flagged", "sources"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
              view === v
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {TAB_LABEL[v]}
          </button>
        ))}
      </div>
      {view === "decisions" ? (
        <span className="text-[12px] text-muted-foreground">
          {usable
            ? // "enforcing right now" rather than "active": the number drops
              // when a ban expires, and the old wording made that read as
              // something going missing.
              `${decisionCount} enforcing now`
            : "Not enabled"}
        </span>
      ) : null}
      <div className="flex-1" />
      {view === "decisions" ? (
        <>
          {usable ? <BlockIpForm onBlock={onBlock} blocking={blocking} /> : null}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
