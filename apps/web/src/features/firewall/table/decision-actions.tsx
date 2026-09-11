/**
 * What you can DO from the firewall feed.
 *
 * A log you can only read is half a tool here: the reason an operator opens
 * this page at 3am is to lift a ban that caught someone real, or to add one
 * that CrowdSec did not. Both are on the old view (`Block IP`, `Unblock`,
 * `Refresh`) and both come across.
 *
 * Unblock is only offered on a decision that is still ENFORCED. An expired one
 * has nothing to lift, and a button that would report success for doing nothing
 * is worse than no button.
 */

import { useState } from "react";

import { PlusSignCircleIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { BAN_DURATIONS } from "@/features/firewall/ban-durations";
import { DEFAULT_BAN_HOURS } from "@/features/firewall/decisions";
import { decisionState, type FirewallDecisionRow } from "@/features/firewall/table/decision-cells";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

/**
 * Whether CrowdSec itself is answering.
 *
 * The single most important thing on this page, and the easiest to leave out:
 * if the LAPI is unreachable the table still renders every persisted row, so it
 * looks completely healthy while nothing is being enforced or recorded. An
 * empty table then means "we cannot see" rather than "nothing happened", and
 * only this chip can tell the two apart.
 */
export function LapiStatus({ reachable }: { reachable: boolean | undefined }) {
  if (reachable === undefined) {
    return (
      <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
        checking…
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-[11px] whitespace-nowrap",
        reachable ? "text-muted-foreground" : "text-destructive",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", reachable ? "bg-success" : "bg-destructive")}
      />
      {reachable ? "LAPI reachable" : "LAPI unreachable"}
    </span>
  );
}

export interface DecisionActions {
  /** Lift a live decision. Resolves once the LAPI has accepted it. */
  onUnblock: (row: FirewallDecisionRow) => Promise<void>;
  onBlock: (input: { value: string; reason: string; hours: number }) => Promise<void>;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** False when the caller lacks the capability — the controls say so. */
  canWrite?: boolean;
}

/**
 * The per-row control.
 *
 * Text, not an icon: "Unblock" is a consequential, irreversible-feeling action
 * on a security surface, and an unlabelled glyph in a row of ninety is exactly
 * how the wrong one gets pressed.
 */
export function UnblockAction({
  row,
  onUnblock,
  canWrite = true,
}: {
  row: FirewallDecisionRow;
  onUnblock: (row: FirewallDecisionRow) => Promise<void>;
  canWrite?: boolean;
}) {
  const [pending, setPending] = useState(false);
  // Nothing to lift. The column stays the same width so the rows still line up.
  if (decisionState(row) !== "active") return null;

  return (
    <Button
      variant="ghost"
      size="xs"
      className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
      disabled={pending || !canWrite}
      title={canWrite ? undefined : "Requires the firewall:write capability."}
      onClick={() => {
        setPending(true);
        void onUnblock(row).finally(() => setPending(false));
      }}
    >
      {pending ? "Unblocking…" : "Unblock"}
    </Button>
  );
}

/** The toolbar pair: add a decision CrowdSec did not make, and re-poll. */
export function DecisionToolbarActions({
  onBlock,
  onRefresh,
  isRefreshing = false,
  canWrite = true,
  lapiReachable,
}: Omit<DecisionActions, "onUnblock"> & { lapiReachable?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <LapiStatus reachable={lapiReachable} />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 whitespace-nowrap"
        disabled={!canWrite}
        onClick={() => setOpen(true)}
        title={canWrite ? undefined : "Requires the firewall:write capability."}
      >
        <HugeiconsIcon icon={PlusSignCircleIcon} strokeWidth={2} className="size-3.5" />
        Block IP
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 whitespace-nowrap"
        disabled={isRefreshing}
        onClick={onRefresh}
        aria-label="Re-poll CrowdSec"
      >
        <HugeiconsIcon
          icon={RefreshIcon}
          strokeWidth={2}
          className="size-3.5 motion-safe:data-[spinning=true]:animate-spin"
          data-spinning={isRefreshing}
        />
        Refresh
      </Button>
      <BlockDialog open={open} onOpenChange={setOpen} onBlock={onBlock} />
    </>
  );
}

/**
 * Adding a decision by hand.
 *
 * The reason is required, not optional. A manual ban outlives the person who
 * placed it, and `cscli` records the reason as the scenario — so the Scenario
 * column either explains itself six months later or reads `manual:` and tells
 * the next operator nothing about whether it is safe to lift.
 */
function BlockDialog({
  open,
  onOpenChange,
  onBlock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBlock: (input: { value: string; reason: string; hours: number }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState<number>(DEFAULT_BAN_HOURS);
  const [pending, setPending] = useState(false);
  const ready = value.trim().length >= 3 && reason.trim().length > 0;

  const submit = () => {
    if (!ready) return;
    setPending(true);
    void onBlock({ value: value.trim(), reason: reason.trim(), hours })
      .then(() => {
        onOpenChange(false);
        setValue("");
        setReason("");
      })
      .finally(() => setPending(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Block an address</DialogTitle>
          <DialogDescription>
            Adds a CrowdSec decision enforced at the host firewall and at the edge. Reversible from
            this table.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="fw-block-value" className="text-xs">
              IP or CIDR range
            </Label>
            <Input
              id="fw-block-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="203.0.113.42 or 203.0.113.0/24"
              className="font-mono text-[13px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fw-block-reason" className="text-xs">
              Reason
            </Label>
            <Input
              id="fw-block-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="scraping the pricing page"
              className="text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Recorded as the decision&apos;s scenario. It is what the next person reads when
              deciding whether to lift this.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fw-block-length" className="text-xs">
              Length
            </Label>
            {/* The same six lengths every other block control offers. A dialog
                with its own list is how "7 days" comes to mean two things. */}
            <Select value={String(hours)} onValueChange={(next) => setHours(Number(next))}>
              <SelectTrigger id="fw-block-length" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAN_DURATIONS.map((duration) => (
                  <SelectItem key={duration.hours} value={String(duration.hours)}>
                    {t(duration.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready || pending} onClick={submit}>
            {pending ? "Blocking…" : "Block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
