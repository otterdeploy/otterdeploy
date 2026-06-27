import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { WorkspaceRouteRow } from "../types";

interface Props {
  rows: ReadonlyArray<WorkspaceRouteRow>;
}

export function WorkspaceRoutesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No routes yet</EmptyTitle>
        <EmptyDescription>
          Routes appear here as soon as a project exposes a public domain. Open a project's
          Networking screen to add one.
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ route, project }) => (
          <TableRow key={route.id}>
            <TableCell className="font-mono text-xs">{route.domain}</TableCell>
            <TableCell>
              <Link
                to="/project/$projectId"
                params={{ projectId: project.id }}
                className="text-sm hover:underline"
              >
                {project.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] uppercase">
                {route.type}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={route.enabled ? "success" : "warning"}>
                {route.enabled ? "enabled" : "disabled"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
