/**
 * What you can DO from the access log.
 *
 * The old view carried four controls that a read-only table would drop on the
 * floor: block the client behind a row, block every scanner the suspicious
 * filter found, export what is loaded, and pause the tail. The last is the
 * shell's own Live toggle; the other three live here.
 *
 * Both block actions confirm first. Banning an IP is outward-facing enforcement
 * — it reaches the host firewall and the edge — and the one-click version of
 * that is how a shared office NAT gets blocked at 3am.
 */

import { useState } from "react";

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { EdgeAccessRow } from "@/features/edge-logs/table/access-columns";

import { BAN_DURATIONS } from "@/features/firewall/ban-durations";
import { BlockSplitButton } from "@/features/firewall/components/block-split-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

/** The duration labels are i18n keys; the confirm needs plain words, and this
 *  table is the one place they are read outside a `t()` call. */
const LENGTH_TEXT: Record<string, string> = {
  "firewall.duration.hour1": "1 hour",
  "firewall.duration.hours24": "24 hours",
  "firewall.duration.days7": "7 days",
  "firewall.duration.days30": "30 days",
  "firewall.duration.days180": "180 days",
  "firewall.duration.forever": "ever",
};

const DEFAULT_BAN_LABEL = "30 days";

export interface AccessLogActions {
  /**
   * Ban one client at the CrowdSec edge. Reversible from the Firewall view.
   *
   * `hours` is undefined for the default length — see `BAN_DURATIONS`, which is
   * the only list of ban lengths in the app.
   */
  onBlockIp: (ip: string, hours?: number) => Promise<void>;
  /** Ban every listed offender in one batch. */
  onBlockAll: (ips: readonly string[], hours?: number) => Promise<void>;
  onExport: (rows: readonly EdgeAccessRow[]) => void;
  /** IPs already banned — their rows offer nothing to do. */
  bannedIps?: ReadonlySet<string>;
  /** False when the caller lacks the capability. */
  canBlock?: boolean;
}

/**
 * The per-row control.
 *
 * Already-banned clients say so instead of offering the action again: the row
 * is still in the log (the request happened), and a second Block would be a
 * no-op reported as a success.
 */
export function BlockIpAction({
  row,
  onBlockIp,
  bannedIps,
  canBlock = true,
}: {
  row: EdgeAccessRow;
  onBlockIp: (ip: string, hours?: number) => Promise<void>;
  bannedIps?: ReadonlySet<string>;
  canBlock?: boolean;
}) {
  /** The length awaiting confirmation. `null` = no dialog open. */
  const [pendingHours, setPendingHours] = useState<number | null | undefined>(null);
  const [working, setWorking] = useState(false);

  if (bannedIps?.has(row.clientIp)) {
    return <span className="font-mono text-[10px] text-muted-foreground">blocked</span>;
  }
  if (!canBlock) return null;

  return (
    <AlertDialog
      open={pendingHours !== null}
      onOpenChange={(open) => open || setPendingHours(null)}
    >
      <BlockSplitButton
        label="Block"
        menuLabel={`Block ${row.clientIp} for a chosen length`}
        disabled={working}
        onBlock={(hours) => setPendingHours(hours)}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {row.clientIp}?</AlertDialogTitle>
          <AlertDialogDescription>
            {banLengthSentence(pendingHours)} Every request from this address is refused at the host
            firewall and at the edge, before it reaches your services. Reversible from Firewall →
            decisions.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const hours = pendingHours ?? undefined;
              setWorking(true);
              setPendingHours(null);
              void onBlockIp(row.clientIp, hours).finally(() => setWorking(false));
            }}
          >
            Block
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The chosen length, said back before the click that applies it.
 *
 * A confirm that does not name the duration is only half a confirm: "Block
 * 203.0.113.42?" reads the same whether the menu said an hour or forever, and
 * forever is the one nobody wants to discover afterwards.
 */
function banLengthSentence(hours: number | null | undefined): string {
  if (hours === undefined || hours === null) {
    return `Banned for ${DEFAULT_BAN_LABEL}.`;
  }
  const match = BAN_DURATIONS.find((duration) => duration.hours === hours);
  return match
    ? `Banned for ${LENGTH_TEXT[match.labelKey] ?? `${hours}h`}.`
    : `Banned for ${hours}h.`;
}

/**
 * Toolbar: export what is loaded, and the bulk block.
 *
 * The bulk action appears only when the rows in hand are ALREADY narrowed to
 * probes — a "Block all" over an unfiltered access log would ban every visitor
 * on the page. It counts distinct addresses, not rows: one scanner hitting
 * forty paths is one ban, and "Block 40 IPs" for it would be a lie about what
 * the button does.
 */
export function AccessLogToolbarActions({
  rows,
  suspiciousOnly,
  onBlockAll,
  onExport,
  bannedIps,
  canBlock = true,
}: {
  rows: readonly EdgeAccessRow[];
  /** The suspicious filter is on, so `rows` are all probes. */
  suspiciousOnly: boolean;
  onBlockAll: (ips: readonly string[], hours?: number) => Promise<void>;
  onExport: (rows: readonly EdgeAccessRow[]) => void;
  bannedIps?: ReadonlySet<string>;
  canBlock?: boolean;
}) {
  const [pendingHours, setPendingHours] = useState<number | null | undefined>(null);
  const offenders = [
    ...new Set(rows.map((row) => row.clientIp).filter((ip) => !bannedIps?.has(ip))),
  ];
  const showBulk = suspiciousOnly && canBlock && offenders.length > 0;

  return (
    <>
      {showBulk ? (
        <AlertDialog
          open={pendingHours !== null}
          onOpenChange={(open) => open || setPendingHours(null)}
        >
          <BlockSplitButton
            size="sm"
            label={`Block ${offenders.length} IP${offenders.length === 1 ? "" : "s"}`}
            menuLabel={`Block ${offenders.length} addresses for a chosen length`}
            onBlock={(hours) => setPendingHours(hours)}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Block {offenders.length} address{offenders.length === 1 ? "" : "es"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {banLengthSentence(pendingHours)} Every distinct client behind the probe requests
                currently loaded. Each is refused at the host firewall and at the edge, and each is
                reversible from Firewall → decisions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const hours = pendingHours ?? undefined;
                  setPendingHours(null);
                  void onBlockAll(offenders, hours);
                }}
              >
                Block {offenders.length}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 whitespace-nowrap"
        disabled={rows.length === 0}
        onClick={() => onExport(rows)}
        title={`Export the ${rows.length} rows loaded so far`}
      >
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
        Export
      </Button>
    </>
  );
}
