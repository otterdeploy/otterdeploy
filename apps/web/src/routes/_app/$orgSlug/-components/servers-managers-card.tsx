/**
 * Managers & quorum — the Raft pane from the design's cluster settings,
 * living where operators already look at nodes. Renders ONLY when the swarm
 * runtime is active: on plain docker there is no quorum to be honest about,
 * so the card stays away instead of showing an empty cluster (the health
 * sheet carries the "requires Docker Swarm" copy for the actions).
 *
 * All nodes are listed (workers dimmed, like the design target) so promote
 * lives next to the managers it would join.
 */
import { type SwarmNode, type SwarmNodesView } from "@/features/servers/data/swarm";
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

import { quorumRequired, RoleChangeAction } from "./servers-swarm-actions";

export function ManagersQuorumCard({ view }: { view: SwarmNodesView | null }) {
  if (!view?.swarm || view.nodes.length === 0) return null;

  const managers = view.nodes.filter((n) => n.role === "manager");
  const required = quorumRequired(managers.length);
  const reachable = managers.filter((m) => m.leader || m.reachability === "reachable").length;
  const healthy = reachable >= required;

  const nodes = view.nodes.toSorted((a, b) => {
    if (a.role !== b.role) return a.role === "manager" ? -1 : 1;
    if (a.leader !== b.leader) return a.leader ? -1 : 1;
    return a.hostname.localeCompare(b.hostname);
  });

  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium">Managers &amp; quorum</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {managers.length} manager{managers.length === 1 ? "" : "s"} · Raft consensus keeps
            cluster state consistent
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-5.5 gap-1.5 px-2 font-mono text-[10.5px] font-medium",
            healthy
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", healthy ? "bg-success" : "bg-destructive")}
          />
          {required} of {managers.length} required for quorum
        </Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="pl-4">Node</TableHead>
            <TableHead className="w-[100px]">Role</TableHead>
            <TableHead className="w-[150px]">Address</TableHead>
            <TableHead className="w-[120px]">Engine</TableHead>
            <TableHead className="w-[130px]">Reachability</TableHead>
            <TableHead className="w-[100px] pr-4 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => (
            <TableRow key={n.id} className={cn(n.role === "worker" && "opacity-60")}>
              <TableCell className="pl-4">
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-[12.5px] font-medium">{n.hostname}</span>
                  {n.leader && (
                    <Badge
                      variant="outline"
                      className="h-4.5 border-success/30 bg-success/10 px-1.5 font-mono text-[10px] font-medium text-success"
                    >
                      leader
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                {n.role}
              </TableCell>
              <TableCell className="font-mono text-[11.5px]">
                {n.addr ?? <span className="text-muted-foreground/40">—</span>}
              </TableCell>
              <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                {n.engineVersion ?? <span className="text-muted-foreground/40">—</span>}
              </TableCell>
              <TableCell>
                <ReachabilityBadge node={n} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <RoleChangeAction node={n} managerCount={managers.length} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ReachabilityBadge({ node }: { node: SwarmNode }) {
  // Reachability is a ManagerStatus concept — workers report only node state.
  if (node.role !== "manager") {
    return (
      <span className="font-mono text-[11px] text-muted-foreground/60">
        {node.state === "ready" ? "ready" : node.state}
      </span>
    );
  }
  const reachable = node.leader || node.reachability === "reachable";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium",
        reachable
          ? "border-success/30 bg-success/15 text-success"
          : "border-destructive/30 bg-destructive/15 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", reachable ? "bg-success" : "bg-destructive")} />
      {reachable ? "reachable" : (node.reachability ?? "unknown")}
    </span>
  );
}
