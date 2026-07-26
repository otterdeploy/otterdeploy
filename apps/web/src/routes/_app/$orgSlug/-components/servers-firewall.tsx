/**
 * Firewall-state badge + "Reapply firewall" remediation for a Servers row
 * (od-5j8.34). The backend has tracked `firewallStatus` /
 * `firewallBouncerActive` and shipped `server.reapplyFirewall` since od-5j8.11
 * — this was the last mile: nothing surfaced drift, so an operator couldn't
 * see an unprotected node or fix it from here.
 *
 * Honesty rules (see servers-firewall.ts + its tests):
 *  - `unknown` renders as a neutral chip, never green — a node whose
 *    baseline was never established must not look protected.
 *  - The nftables-baseline state and the CrowdSec-bouncer fact are two
 *    separate chips, not folded into one badge.
 *
 * Remediation reuses the exact `provisionLogs` stream the initial-provision
 * flow already renders (ProvisionProgress) — `reapplyFirewall` enqueues the
 * SAME job in `firewallOnly` mode (firewall-remediation.ts), so this gets
 * real per-step progress and the real failure line for free, instead of a
 * spinner-then-generic-toast.
 */
import { useEffect, useRef, useState } from "react";

import {
  Alert01Icon,
  Shield01Icon,
  ShieldQuestionMarkIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { useLogStream } from "@/features/logs/data/use-log-stream";
import { serverCollection, type Server } from "@/features/servers/data/server";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  firewallStateLabel,
  summarizeFirewall,
  type FirewallState,
  type FirewallStatusValue,
} from "./servers-firewall-state";

const STATE_TONE: Record<FirewallState, string> = {
  unknown: "border-border bg-muted text-muted-foreground",
  enforced: "border-success/30 bg-success/10 text-success",
  drifted: "border-warning/30 bg-warning/10 text-warning",
};

const STATE_ICON: Record<FirewallState, typeof Shield01Icon> = {
  unknown: ShieldQuestionMarkIcon,
  enforced: Shield01Icon,
  drifted: Alert01Icon,
};

const STATUS_DETAIL: Record<FirewallStatusValue, string> = {
  unknown: "No firewall baseline has been recorded for this node yet.",
  applied: "The nftables baseline was applied to this node.",
  failed: "The last firewall apply attempt failed.",
  unsupported: "An existing firewall (ufw/firewalld) took precedence — narrated, not a failure.",
};

/**
 * The row's firewall facts: state badge (unknown/enforced/drifted) + a
 * separate bouncer chip, plus the reapply action when drifted.
 */
export function FirewallCell({ server }: { server: Server }) {
  const summary = summarizeFirewall(server);
  const title = [
    STATUS_DETAIL[summary.status],
    server.firewallError ? `Last error: ${server.firewallError}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium",
            STATE_TONE[summary.state],
          )}
          title={title}
        >
          <HugeiconsIcon icon={STATE_ICON[summary.state]} strokeWidth={2} className="size-3" />
          {firewallStateLabel(summary.state)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "h-5 px-1.5 font-mono text-[10px] font-normal",
            summary.bouncerActive
              ? "border-success/30 bg-success/10 text-success"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          bouncer {summary.bouncerActive ? "on" : "off"}
        </Badge>
      </div>
      {summary.drifted && <ReapplyFirewallAction server={server} />}
    </div>
  );
}

function reapplyErrorMessage(err: unknown, name: string): string {
  return err instanceof Error && err.message
    ? err.message
    : `Couldn't queue a firewall reapply for ${name}`;
}

/** Strips the emitted "✓ "/"✗ " marker prefix for use as plain toast copy. */
function lineText(line: string): string {
  return line.replace(/^[✓✗]\s*/, "");
}

/**
 * "Reapply firewall" — only rendered for drifted rows. Two phases:
 * `queuing` (the reapplyFirewall call itself, in flight) and `streaming`
 * (watching the job's real provisionLogs output). Both surface the actual
 * server-reported text on failure.
 */
function ReapplyFirewallAction({ server }: { server: Server }) {
  const [phase, setPhase] = useState<"idle" | "queuing" | "streaming">("idle");
  const blockedReason = server.sshKeyId
    ? null
    : "No stored managed SSH key on this server — re-add it with a managed key to enable remediation";

  const start = () => {
    setPhase("queuing");
    orpc.server.reapplyFirewall
      .call({ id: server.id })
      .then((updated) => {
        serverCollection.utils.writeUpdate(updated);
        setPhase("streaming");
      })
      .catch((err: unknown) => {
        toast.error(reapplyErrorMessage(err, server.name));
        setPhase("idle");
      });
  };

  return (
    <Popover
      open={phase !== "idle"}
      onOpenChange={(next) => {
        // Dismissing (click-away / Escape) just closes the panel — the job
        // itself is a backend BullMQ run, unaffected by the client tab.
        if (!next) setPhase("idle");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={phase !== "idle" || blockedReason !== null}
            title={blockedReason ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              start();
            }}
          >
            {phase === "queuing" ? "Queuing…" : phase === "streaming" ? "Reapplying…" : "Reapply firewall"}
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-80 gap-0 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "streaming" && (
          <ReapplyProgress server={server} onFinished={() => setPhase("idle")} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function lineTone(line: string): string {
  if (line.startsWith("✗")) return "text-destructive";
  if (line.startsWith("✓")) return "text-success";
  if (line.startsWith("──")) return "text-foreground";
  return "text-muted-foreground";
}

/**
 * Live tail of the firewall-only job for one server, via the same
 * `provisionLogs` event iterator + `useLogStream` the initial-provision
 * dialog uses (server-provision-progress.tsx). Terminal detection reads the
 * emit markers firewall-remediation.ts writes ("✓ firewall remediation
 * complete" / "✗ firewall remediation …") — there's no `provisionStatus`
 * transition to poll here (a firewall-only run deliberately never touches
 * it), so the stream itself is authoritative.
 */
function ReapplyProgress({ server, onFinished }: { server: Server; onFinished: () => void }) {
  const { lines, status } = useLogStream<{ line: string; ts: string }, { seq: number; line: string }>({
    open: (signal) =>
      orpc.server.provisionLogs.call(
        { id: server.id },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (raw, seq) => ({ seq, line: raw.line }),
    deps: [server.id],
    onError: (_err, seq) => ({ seq, line: "— stream disconnected —" }),
  });

  const rawLines = lines.map((l) => l.line);
  const okLine = rawLines.find((l) => l.startsWith("✓"));
  const failLine = rawLines.find((l) => l.startsWith("✗"));
  const finished = okLine != null || failLine != null || status === "ended" || status === "error";

  // Fire exactly once per terminal transition: refresh the row (so the
  // badge picks up the new firewallStatus/bouncer state) and toast the real
  // outcome text — never a generic string. A ref (not state) guards the
  // one-shot so this stays a pure render plus a side-effect, not a
  // state-during-render trick.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!finished || notifiedRef.current) return;
    notifiedRef.current = true;
    void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
    if (failLine) {
      toast.error(`${server.name}: ${lineText(failLine)}`);
    } else if (okLine) {
      toast.success(`${server.name}: ${lineText(okLine)}`);
    } else {
      toast.error(`${server.name}: firewall reapply stream disconnected before finishing`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-medium text-muted-foreground">
        {!finished && <Spinner className="size-3" />}
        {finished
          ? failLine
            ? "Firewall reapply failed"
            : "Firewall reapply complete"
          : "Reapplying firewall…"}
      </div>
      <div className="max-h-40 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <span className="text-muted-foreground">connecting…</span>
        ) : (
          lines.map((l) => (
            <div key={l.seq} className={lineTone(l.line)}>
              {l.line}
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end border-t px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onFinished();
          }}
        >
          {finished ? "Close" : "Run in background"}
        </Button>
      </div>
    </div>
  );
}
