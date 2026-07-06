/**
 * The Servers node table (+ its empty state) — extracted from ServersRoute so
 * the route stays inside the lint size budget and the table's column set has
 * one home. Rows open the per-server health sheet via onOpenServer.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";

import { type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { ServerRow, type ServerRowStats } from "./servers-row";

export function ServersTable({
  servers,
  statsByServer,
  healthByServer,
  onOpenServer,
  onCreate,
}: {
  servers: Server[];
  statsByServer: ReadonlyMap<string, ServerRowStats>;
  healthByServer: ReadonlyMap<string, ServerHealthEntry>;
  onOpenServer: (serverId: string) => void;
  onCreate: () => void;
}) {
  if (servers.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={ServerStack01Icon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>No servers registered</EmptyTitle>
          <EmptyDescription>
            Join a host to the swarm and register it here. The orchestrator will start scheduling
            services onto it once it appears.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" className="h-8" onClick={onCreate}>
            + Add server
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="pl-4">Hostname</TableHead>
            <TableHead className="w-[110px]">Role</TableHead>
            <TableHead className="w-[140px]">Availability</TableHead>
            <TableHead>CPU · Memory</TableHead>
            <TableHead className="w-[150px]">Live</TableHead>
            <TableHead className="w-[80px] text-right">Tasks</TableHead>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead className="w-[40px] pr-3" aria-label="Open" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              stats={statsByServer.get(server.id) ?? null}
              health={healthByServer.get(server.id) ?? null}
              onOpen={() => onOpenServer(server.id)}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
