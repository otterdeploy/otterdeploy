import { Share2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectRouteRow } from "../types";

type Props = {
  rows: ReadonlyArray<ProjectRouteRow>;
};

export function ProjectRoutesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Empty>
        <Share2Icon className="size-6" />
        <EmptyTitle>No routes yet</EmptyTitle>
        <EmptyDescription>
          Add a public domain to expose a service or database. Editor ships in Plan 6.
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Upstream</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ route }) => (
          <TableRow key={route.id}>
            <TableCell className="font-mono text-xs">{route.domain}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] uppercase">{route.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{route.upstreamHost}:{route.upstreamPort}</TableCell>
            <TableCell>
              <Badge variant={route.enabled ? "success" : "warning"}>
                {route.enabled ? "enabled" : "disabled"}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <Tooltip>
                <TooltipTrigger render={<Button size="xs" variant="outline" disabled>Edit</Button>} />
                <TooltipPopup>Route editor ships in Plan 6</TooltipPopup>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
