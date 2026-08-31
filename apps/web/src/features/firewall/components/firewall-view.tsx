/**
 * Firewall view: CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge page (an edge-level concern: cluster-wide and identity-blind, so it
 * sits beside Access logs at the org scope).
 *
 * Layout, and the reason for it: a title row that also carries every ACTION
 * (block, refresh, mass-block) so the buttons never move as you switch tabs,
 * then one toolbar carrying every FILTER and the single search box, then the
 * table. Each tab used to own a second toolbar with its own prose and its own
 * controls, which is what made four tabs read as four different products.
 */
import { useEffect, useState } from "react";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { BlockedRange, BlockedState, FirewallWindow } from "../data";
import type { FirewallTab } from "../tabs";

import { BlockAllButton } from "../../edge-logs/components/edge-logs-block-ip";
import { flaggedFields, flaggedQuery, prefetchFirewall, statusQuery } from "../data";
import { blockIps, unblockIp, useBannedIps, useCanBlock } from "../decisions";
import { filterRows } from "../search";
import { useFirewallActions } from "../use-firewall-actions";
import { BlockIpAction } from "./block-ip-action";
import { BlockedPanel, useBlockedRows } from "./blocked-panel";
import { BlocklistsPanel } from "./blocklists-panel";
import { FirewallDisabledCard } from "./firewall-disabled-card";
import { FirewallFilters } from "./firewall-filters";
import { FirewallHeader } from "./firewall-header";
import { FirewallToolbar } from "./firewall-toolbar";
import { FlaggedPanel } from "./flagged-panel";

/** One placeholder per tab, naming fields that tab actually has: a search box
 *  that says "Search" teaches nobody what it will match. */
const SEARCH_PLACEHOLDER: Record<FirewallTab, string> = {
  blocked: "Search IP, country, network, scenario…",
  flagged: "Search IP, country, path…",
  sources: "Search lists…",
};

/** The batch block endpoint caps a call at 100 IPs. */
const BLOCK_MANY_LIMIT = 100;

export function FirewallView() {
  const queryClient = useQueryClient();
  const status = useQuery(statusQuery());

  const [tab, setTab] = useState<FirewallTab>("blocked");
  const [range, setRange] = useState<BlockedRange>("now");
  const [state, setState] = useState<BlockedState>("all");
  const [flaggedWindow, setFlaggedWindow] = useState<FirewallWindow>("all");
  const [search, setSearch] = useState("");

  // Warm every tab on mount as well as in the route loader: a direct
  // navigation (paste a URL, reload) has no hover to preload from.
  useEffect(() => {
    prefetchFirewall(queryClient);
  }, [queryClient]);

  const blocked = useBlockedRows(range, state, search);
  const flagged = useQuery(flaggedQuery(flaggedWindow));
  const flaggedRows = flagged.data ?? [];
  const flaggedShown = filterRows(flaggedRows, search, flaggedFields);

  // Active bans decide which affordance a Flagged row offers (Block, or
  // Unblock). Read from the decision collection, so a block applied on one row
  // is reflected here on the same tick rather than after the next poll.
  const canBlock = useCanBlock();
  const bannedIps = useBannedIps(canBlock);
  const actions = useFirewallActions();

  // Mass-block acts on what is ON SCREEN, not on the whole window: an operator
  // who has narrowed to one country must not silently ban the rest as well.
  const blockTargets = flaggedShown
    .reduce<string[]>((acc, r) => {
      if (!bannedIps.has(r.ip)) acc.push(r.ip);
      return acc;
    }, [])
    .slice(0, BLOCK_MANY_LIMIT);

  const reachable = Boolean(status.data?.reachable);
  const configured = Boolean(status.data?.configured);
  // The firewall is usable whenever the agent answers over the Docker socket
  // (reachable) OR the bouncer env is set (configured). Decisions are read AND
  // written purely via `cscli` exec, independent of the CROWDSEC_* env, so a
  // running agent must surface its blocked IPs even when the server process
  // lacks those vars. Gating on `configured` alone hid every blocked IP.
  const usable = configured || reachable;
  const searching = search.trim().length > 0;

  // Tracked explicitly rather than read off `isFetching`: the decisions query
  // polls every 15s, so a fetching-derived flag made the button spin and go
  // disabled twice a minute on its own, which reads as the page doing
  // something the operator didn't ask for.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    // `allSettled` never rejects, so the spinner always stops — including when
    // the control plane is the thing that's down.
    void Promise.allSettled([status.refetch(), actions.refresh()]).then(() => setRefreshing(false));
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <FirewallHeader configured={configured} reachable={reachable}>
        {tab === "flagged" && blockTargets.length > 0 ? (
          <BlockAllButton count={blockTargets.length} onConfirm={() => blockIps(blockTargets)} />
        ) : null}
        {usable ? (
          <BlockIpAction onBlock={(ip, durationHours) => blockIps([ip], durationHours)} />
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            strokeWidth={2}
            className={cn("size-3.5", refreshing && "animate-spin")}
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </FirewallHeader>

      <FirewallToolbar
        tab={tab}
        onTabChange={setTab}
        counts={{ blocked: blocked.liveCount, flagged: flaggedRows.length }}
        filters={
          <FirewallFilters
            tab={tab}
            range={range}
            onRangeChange={setRange}
            state={state}
            onStateChange={setState}
            stateCounts={blocked.stateCounts}
            flaggedWindow={flaggedWindow}
            onFlaggedWindowChange={setFlaggedWindow}
          />
        }
        search={
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[tab]}
            aria-label={SEARCH_PLACEHOLDER[tab]}
            className="w-full text-xs lg:w-64"
          />
        }
      />

      {tab === "sources" ? (
        <BlocklistsPanel search={search} />
      ) : tab === "flagged" ? (
        <FlaggedPanel
          rows={flaggedShown}
          total={flaggedRows.length}
          loading={flagged.isLoading}
          searching={searching}
          bannedIps={bannedIps}
        />
      ) : usable ? (
        <BlockedPanel
          rows={blocked.rows}
          total={blocked.total}
          loading={blocked.loading}
          range={range}
          state={state}
          searching={searching}
          onUnblock={unblockIp}
        />
      ) : (
        <FirewallDisabledCard />
      )}
    </div>
  );
}
