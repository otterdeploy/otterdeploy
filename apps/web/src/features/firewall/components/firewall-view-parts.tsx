import type { ReactNode } from "react";

import { FirewallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Card } from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { flagEmoji } from "@/shared/lib/flag";
import { cn } from "@/shared/lib/utils";
import type { orpc } from "@/shared/server/orpc";

type Decision = Awaited<ReturnType<typeof orpc.firewall.decisions.call>>[number];

/** The active-decisions table (banned IPs/ranges/countries), with a per-IP
 *  Unblock action. Split out of FirewallView to keep that file within bounds. */
export function DecisionsTable({
  rows,
  reachable,
  onUnblock,
  unblocking,
}: {
  rows: Decision[];
  reachable: boolean;
  onUnblock: (ip: string) => void;
  unblocking: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            {[
              "Value",
              "Country",
              "AS / Network",
              "Scenario",
              "Events",
              "Action",
              "Expires",
              "Origin",
              "",
            ].map((h, i) => (
              <TableHead
                key={h || `col-${i}`}
                className="h-8 text-[10px] font-semibold tracking-[0.06em] uppercase"
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={9} className="py-10 text-center text-[13px] text-muted-foreground">
                {reachable
                  ? "No active decisions — nothing is currently blocked."
                  : "Can't reach the CrowdSec agent — is the firewall profile running?"}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((d, i) => (
              <TableRow key={`${d.value}-${d.id ?? i}`} className="font-mono text-[12px]">
                <TableCell className="text-foreground/90">
                  {d.value}
                  {d.scope !== "Ip" ? (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/70">{d.scope}</span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {d.country ? (
                    <span title={d.country}>
                      {flagEmoji(d.country)} {d.country}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </TableCell>
                <TableCell
                  className="max-w-[220px] truncate text-muted-foreground"
                  title={d.asName ?? undefined}
                >
                  {d.asNumber || d.asName ? (
                    <>
                      {d.asNumber ? (
                        <span className="text-foreground/70">AS{d.asNumber}</span>
                      ) : null}
                      {d.asName ? <span className="ml-1.5">{d.asName}</span> : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </TableCell>
                <TableCell
                  className="max-w-[200px] truncate text-muted-foreground"
                  title={d.scenario}
                >
                  {d.scenario || <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.eventsCount ?? <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell>
                  <span className={cn(d.type === "ban" ? "text-destructive" : "text-amber-500")}>
                    {d.type}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {d.duration}
                </TableCell>
                <TableCell className="text-muted-foreground">{d.origin}</TableCell>
                <TableCell className="text-right">
                  {d.scope === "Ip" ? (
                    <button
                      type="button"
                      onClick={() => onUnblock(d.value)}
                      disabled={unblocking}
                      className="text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Unblock
                    </button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Empty state shown when the CrowdSec agent hasn't been switched on. */
export function FirewallDisabledCard() {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card className="border-dashed p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={FirewallIcon} strokeWidth={1.8} className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">Firewall isn't enabled</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              The CrowdSec agent ships with otterdeploy — it just stays off until you switch it on.
              Two steps:
            </p>
            <ol className="mt-3 space-y-2.5 text-[13px]">
              <li className="flex gap-2.5">
                <SetupStep n={1} />
                <span className="text-muted-foreground">
                  Set <CodeChip>CROWDSEC_BOUNCER_KEY</CodeChip> to a strong secret and{" "}
                  <CodeChip>CROWDSEC_LAPI_URL=http://crowdsec:8080</CodeChip>
                </span>
              </li>
              <li className="flex gap-2.5">
                <SetupStep n={2} />
                <span className="text-muted-foreground">
                  Start the bundled agent:{" "}
                  <CodeChip>docker compose --profile firewall up -d</CodeChip>
                </span>
              </li>
            </ol>
            <p className="mt-3 text-[12px] text-muted-foreground/80">
              The edge gate wires in automatically — no Caddy rebuild. Phase 1 enforces the
              community IP blocklist.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CodeChip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/90">
      {children}
    </code>
  );
}

function SetupStep({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}
