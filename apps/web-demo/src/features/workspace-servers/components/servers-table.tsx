import { ServerIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "../ui/empty";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ServersTable() {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="sm" disabled>
                + Add server
              </Button>
            }
          />
          <TooltipPopup>Server provisioning ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Disk</TableHead>
            <TableHead>Uptime</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* rows render here when the Swarm-nodes API ships */}
        </TableBody>
      </Table>

      <Empty>
        <ServerIcon className="size-6" />
        <EmptyTitle>No servers connected</EmptyTitle>
        <EmptyDescription>
          Add a server by pasting its Swarm join token to spread workloads
          across machines. Backend ships in Plan 6.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
