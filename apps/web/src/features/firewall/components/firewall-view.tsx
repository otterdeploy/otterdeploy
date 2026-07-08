/**
 * Firewall view — CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge Logs page (an edge-level concern: cluster-wide / identity-blind, so
 * it sits beside Access + Events at the org scope). Follows the same full-height
 * instrument layout as those views: header + status pill, a hairline toolbar,
 * then a full-bleed table that fills the remaining height.
 */
import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { BlocklistsPanel } from "./blocklists-panel";
import { DecisionsTable, FirewallDisabledCard } from "./firewall-view-parts";
import { FlaggedPanel } from "./flagged-panel";

type View = "decisions" | "flagged" | "sources";

export function FirewallView() {
  const status = useQuery({
    ...orpc.firewall.status.queryOptions(),
    refetchInterval: 15_000,
  });
  const decisions = useQuery({
    ...orpc.firewall.decisions.queryOptions(),
    refetchInterval: 15_000,
  });

  const s = status.data;
  const rows = decisions.data ?? [];
  const reachable = Boolean(s?.reachable);
  const configured = Boolean(s?.configured);
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
        configured={configured}
        decisionCount={rows.length}
        refreshing={decisions.isFetching}
        onRefresh={() => {
          void status.refetch();
          void decisions.refetch();
        }}
        onBlock={(ip) => block.mutate({ ip })}
        blocking={block.isPending}
      />

      {view === "sources" ? (
        <BlocklistsPanel />
      ) : view === "flagged" ? (
        <FlaggedPanel />
      ) : !configured ? (
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
  return (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Firewall</h1>
        {configured ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              reachable ? "text-success" : "text-destructive",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                reachable ? "animate-pulse bg-success" : "bg-destructive",
              )}
            />
            LAPI {reachable ? "reachable" : "unreachable"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground" />
            disabled
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        CrowdSec IP-reputation decisions enforced at the Caddy edge — banned IPs, ranges, and the
        community blocklist. Identity-blind; runs before the auth wall.
      </p>
    </div>
  );
}

function FirewallToolbar({
  view,
  onViewChange,
  configured,
  decisionCount,
  refreshing,
  onRefresh,
  onBlock,
  blocking,
}: {
  view: View;
  onViewChange: (v: View) => void;
  configured: boolean;
  decisionCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onBlock: (ip: string) => void;
  blocking: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {(["decisions", "flagged", "sources"] as const).map((v) => (
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
            {v === "decisions" ? "Decisions" : v === "flagged" ? "Flagged IPs" : "Sources"}
          </button>
        ))}
      </div>
      {view === "decisions" ? (
        <span className="text-[12px] text-muted-foreground">
          {configured
            ? `${decisionCount} active decision${decisionCount === 1 ? "" : "s"}`
            : "Not enabled"}
        </span>
      ) : null}
      <div className="flex-1" />
      {view === "decisions" ? (
        <>
          {configured ? <BlockIpForm onBlock={onBlock} blocking={blocking} /> : null}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** Inline "block an IP by hand" form — bans the entered IP/CIDR via CrowdSec. */
function BlockIpForm({
  onBlock,
  blocking,
}: {
  onBlock: (ip: string) => void;
  blocking: boolean;
}) {
  const [ip, setIp] = useState("");
  const submit = () => {
    const value = ip.trim();
    if (!value) return;
    onBlock(value);
    setIp("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-1.5"
    >
      <Input
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        placeholder="Block IP or CIDR…"
        aria-label="Block an IP or CIDR range"
        className="h-8 w-44 font-mono text-[12px]"
      />
      <Button type="submit" variant="outline" size="sm" disabled={blocking || !ip.trim()}>
        {blocking ? "Blocking…" : "Block"}
      </Button>
    </form>
  );
}
