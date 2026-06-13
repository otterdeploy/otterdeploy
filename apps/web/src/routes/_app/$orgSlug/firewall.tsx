import { FirewallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/firewall")({
  staticData: { crumb: "Firewall" },
  component: RouteComponent,
});

function RouteComponent() {
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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-base font-semibold">Firewall</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          CrowdSec IP-reputation decisions enforced at the Caddy edge — banned
          IPs, ranges, and the community blocklist. Identity-blind; runs before
          the auth wall.
        </p>
      </div>

      {/* Status banner */}
      {!s?.configured ? (
        <Card className="border-dashed p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <HugeiconsIcon icon={FirewallIcon} strokeWidth={1.8} className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[13px] font-semibold">Firewall isn't enabled</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                The CrowdSec agent ships with otterstack — it just stays off
                until you switch it on. Two steps:
              </p>
              <ol className="mt-3 space-y-2.5 text-[13px]">
                <li className="flex gap-2.5">
                  <SetupStep n={1} />
                  <span className="text-muted-foreground">
                    Set <CodeChip>CROWDSEC_BOUNCER_KEY</CodeChip> to a strong
                    secret and{" "}
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
                The edge gate wires in automatically — no Caddy rebuild. Phase 1
                enforces the community IP blocklist.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
          <Badge variant={s.reachable ? "outline" : "secondary"}>
            <span
              className={cn(
                "mr-1.5 size-1.5 rounded-full",
                s.reachable ? "bg-success" : "bg-destructive",
              )}
            />
            LAPI {s.reachable ? "reachable" : "unreachable"}
          </Badge>
          <span className="text-muted-foreground">
            {s.decisionCount} active decision{s.decisionCount === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <Card className="gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {["Value", "Scope", "Action", "Scenario", "Duration", "Origin"].map(
                (h) => (
                  <TableHead
                    key={h}
                    className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                  >
                    {h}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-[13px] text-muted-foreground"
                >
                  {s?.configured && s.reachable
                    ? "No active decisions — nothing is currently blocked."
                    : "No decisions to show."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d, i) => (
                <TableRow key={`${d.value}-${i}`} className="font-mono text-[12px]">
                  <TableCell className="text-foreground/90">{d.value}</TableCell>
                  <TableCell className="text-muted-foreground">{d.scope}</TableCell>
                  <TableCell>
                    <span className={cn(d.type === "ban" ? "text-destructive" : "text-amber-500")}>
                      {d.type}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.scenario}</TableCell>
                  <TableCell className="text-muted-foreground">{d.duration}</TableCell>
                  <TableCell className="text-muted-foreground">{d.origin}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CodeChip({ children }: { children: React.ReactNode }) {
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
