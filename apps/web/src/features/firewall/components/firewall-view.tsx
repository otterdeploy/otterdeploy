/**
 * Firewall view — CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge Logs page (an edge-level concern: cluster-wide / identity-blind, so
 * it sits beside Access + Events at the org scope). Follows the same full-height
 * instrument layout as those views: header + status pill, a hairline toolbar,
 * then a full-bleed table that fills the remaining height.
 */
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
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
  // The firewall is usable whenever the agent answers over the Docker socket
  // (reachable) OR the bouncer env is set (configured). Decisions are read AND
  // written purely via `cscli` exec, independent of the CROWDSEC_* env — so a
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
  return (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Firewall</h1>
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
          {usable
            ? `${decisionCount} active decision${decisionCount === 1 ? "" : "s"}`
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

/** Ban lengths offered by the manual block form (hours). */
const BLOCK_DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 4320, label: "180 days" },
] as const;

/** Inline "block an IP by hand" form — bans the entered IP/CIDR via CrowdSec
 *  for the selected duration. */
function BlockIpForm({
  onBlock,
  blocking,
}: {
  onBlock: (ip: string, durationHours: number) => void;
  blocking: boolean;
}) {
  const form = useForm({
    defaultValues: { ip: "", hours: 720 },
    onSubmit: ({ value, formApi }) => {
      const ip = value.ip.trim();
      if (!ip) return;
      onBlock(ip, value.hours);
      formApi.setFieldValue("ip", "");
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex items-center gap-1.5"
    >
      <form.Field name="ip">
        {(field) => (
          <Input
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="Block IP or CIDR…"
            aria-label="Block an IP or CIDR range"
            className="h-8 w-44 font-mono text-[12px]"
          />
        )}
      </form.Field>
      <form.Field name="hours">
        {(field) => (
          <select
            value={field.state.value}
            onChange={(e) => field.handleChange(Number(e.target.value))}
            aria-label="Ban duration"
            className="h-8 rounded-md border bg-transparent px-2 text-[12px] text-foreground/90 focus-visible:ring-1 focus-visible:outline-none"
          >
            {BLOCK_DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.ip.trim().length === 0}>
        {(empty) => (
          <Button type="submit" variant="outline" size="sm" disabled={blocking || empty}>
            {blocking ? "Blocking…" : "Block"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
