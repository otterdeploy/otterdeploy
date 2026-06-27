import { Database02Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

import type { SessionSource } from "../types";

interface SshNode {
  id: string;
  name: string;
  host: string;
  labels: readonly string[];
}

interface DatabaseTarget {
  resourceId: string;
  name: string;
  engine: string;
  projectSlug: string;
  projectName: string;
}

export function SshTab({
  servers,
  onPick,
}: {
  servers: SshNode[];
  onPick: (source: SessionSource) => void;
}) {
  return (
    <>
      <p className="text-[12.5px] text-muted-foreground">
        Open a shell on the host or SSH into a swarm node.
      </p>
      {servers.length === 0 ? (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-8">
          <EmptyHeader>
            <HugeiconsIcon
              icon={ServerStack01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No servers</EmptyTitle>
            <EmptyDescription>No servers registered yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        servers.map((n) => {
          // The bootstrap localhost row is the host shell — only it has a wired
          // backend right now (the remote SSH exec path isn't implemented yet).
          // Other rows show but route to the "not implemented" inline message.
          const isLocal = n.labels.includes("bootstrap");
          return (
            <button
              key={n.id}
              type="button"
              onClick={() =>
                onPick({
                  kind: "ssh",
                  mode: isLocal ? "local" : "remote",
                  node: n.name,
                  host: n.host,
                })
              }
              className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-ring"
            >
              <HugeiconsIcon
                icon={ServerStack01Icon}
                strokeWidth={1.8}
                className="size-4 text-muted-foreground"
              />
              <span className="font-mono text-[13px]">{n.name}</span>
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px] font-normal",
                  isLocal ? "border-success/40 bg-success/10 text-success" : null,
                )}
              >
                {isLocal ? "host" : "swarm node"}
              </Badge>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{n.host}</span>
            </button>
          );
        })
      )}
    </>
  );
}

export function DatabaseTab({
  databases,
  onPick,
}: {
  databases: DatabaseTarget[];
  onPick: (source: SessionSource) => void;
}) {
  return (
    <>
      <p className="text-[12.5px] text-muted-foreground">
        Open a database console — psql, redis-cli, mongosh, …
      </p>
      {databases.length === 0 ? (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-8">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No databases</EmptyTitle>
            <EmptyDescription>No databases in any project yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        databases.map((db) => (
          <button
            key={db.resourceId}
            type="button"
            onClick={() =>
              onPick({
                kind: "database",
                engine: db.engine,
                service: db.name,
                project: db.projectSlug,
              })
            }
            className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-ring"
          >
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={1.8}
              className="size-4 text-muted-foreground"
            />
            <span className="font-mono text-[13px]">{db.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] font-normal">
              {db.engine}
            </Badge>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {db.projectName}
            </span>
          </button>
        ))
      )}
    </>
  );
}
