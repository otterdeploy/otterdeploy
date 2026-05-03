import { RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

type Props = {
  scope: "project" | "resource";
};

export function DeploymentsTable({ scope }: Props) {
  return (
    <div className="grid gap-3">
      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>All services</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All statuses</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Last 7 days</ToolbarButton>
      </Toolbar>

      <Table>
        <TableHeader>
          <TableRow>
            {scope === "project" ? <TableHead>Service</TableHead> : null}
            <TableHead>Commit</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Rows render here when project.deployment.list ships in Plan 6 */}
        </TableBody>
      </Table>

      <Empty>
        <RotateCcwIcon className="size-6" />
        <EmptyTitle>No deployments yet</EmptyTitle>
        <EmptyDescription>
          Build and deploy history shows up here. Backend ships in Plan 6.
        </EmptyDescription>
      </Empty>

      <Badge variant="outline" className="w-fit text-[10px]">
        scope: {scope}
      </Badge>
    </div>
  );
}
