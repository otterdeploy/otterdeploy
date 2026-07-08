/**
 * Flagged IPs — client IPs probing the org's domains with scanner-style paths
 * (/.env, /actuator, *.php, ?cmd=…), aggregated from the edge access logs over
 * the last hour. The "review these IPs" surface: each row is one-click blockable
 * at the CrowdSec edge. Independent of whether CrowdSec is configured (the data
 * is edge-log-derived); Block just needs the agent running to enforce.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { flagEmoji } from "@/shared/lib/flag";
import { orpc } from "@/shared/server/orpc";

export function FlaggedPanel() {
  const flagged = useQuery({
    ...orpc.firewall.flagged.queryOptions({ input: { windowMinutes: 60 } }),
    refetchInterval: 15_000,
  });
  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Blocked ${vars.ip} — enforced at the edge`);
        void flagged.refetch();
      } else {
        toast.error(r.error ?? "Block failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });

  const rows = flagged.data ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="border-b px-4 py-2 text-[12px] text-muted-foreground">
        Client IPs probing your domains for secrets and known exploits in the last hour. Blocking
        rejects every future request from that IP at the edge (403).
      </div>
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            {["Client IP", "Country", "Probes", "Sample paths", "Last seen", ""].map((h, i) => (
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
              <TableCell
                colSpan={6}
                className="py-10 text-center text-[13px] text-muted-foreground"
              >
                {flagged.isLoading
                  ? "Loading…"
                  : "No suspicious probing in the last hour. Scanner traffic to your domains appears here."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.ip} className="font-mono text-[12px]">
                <TableCell className="text-foreground/90">{r.ip}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {r.country ? (
                    <span title={r.country}>
                      {flagEmoji(r.country)} {r.country}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </TableCell>
                <TableCell className="text-destructive">{r.count}</TableCell>
                <TableCell
                  className="max-w-[360px] truncate text-muted-foreground"
                  title={r.samplePaths.join("\n")}
                >
                  {r.samplePaths.join("  ·  ")}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(r.lastSeen).toLocaleTimeString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => block.mutate({ ip: r.ip })}
                    disabled={block.isPending}
                  >
                    Block
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
