/** "Block IP" action for the expanded edge-log row — bans the client IP at the
 *  CrowdSec edge (reversible from the Firewall view) behind a confirm, since
 *  it's an outward-facing enforcement action. */

import { useState } from "react";

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

/** Mass-block confirm — bans every listed offender IP in one CrowdSec batch.
 *  Same confirm-first posture as the single-IP action; used by the suspicious
 *  filter here and the Flagged IPs panel in the Firewall view. */
export function BlockAllButton({
  count,
  onConfirm,
  blocking,
}: {
  count: number;
  onConfirm: () => void;
  blocking: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        disabled={blocking}
      >
        {blocking ? "Blocking…" : `Block ${count} IP${count === 1 ? "" : "s"}`}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Block {count} IP{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every request from these IPs will be rejected at the Caddy edge (403) for 30 days,
            before it reaches any of your services. Each ban is individually reversible from the
            Firewall view.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={blocking}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
              setOpen(false);
            }}
            disabled={blocking}
          >
            Block all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function BlockIpButton({
  ip,
  onBlockIp,
  blocking,
}: {
  ip: string;
  onBlockIp: (ip: string) => void;
  blocking: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 text-[11px] text-destructive hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Block IP
      </Button>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Block <span className="font-mono">{ip}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every request from this IP will be rejected at the Caddy edge (403) for 30 days, before
            it reaches any of your services. CrowdSec enforces it cluster-wide — no deploy or reload
            needed. You can undo this from the Firewall view.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={blocking}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onBlockIp(ip);
              setOpen(false);
            }}
            disabled={blocking}
          >
            {blocking ? "Blocking…" : "Block IP"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
