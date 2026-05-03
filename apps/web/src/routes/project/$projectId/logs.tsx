import { createFileRoute } from "@tanstack/react-router";
import { ActivityIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";
import { LogsTerminal } from "@/features/logs-terminal";

export const Route = createFileRoute("/project/$projectId/logs")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  return (
    <div className="grid h-full grid-cols-[1fr_280px] gap-3 p-3">
      <div className="grid grid-rows-[auto_1fr] gap-2 min-h-0">
        <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
          <ToolbarButton disabled>Filter and search…</ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton disabled>All services</ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton disabled>All severities</ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton disabled>Last 15 min</ToolbarButton>
        </Toolbar>
        <div className="min-h-0 overflow-hidden rounded-lg border">
          <LogsTerminal scope={{ kind: "project", projectId }} />
        </div>
      </div>

      <aside className="grid gap-2 self-start rounded-lg border bg-background p-3 text-sm">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <ActivityIcon className="size-3" /> Activity
        </div>
        <Empty>
          <EmptyTitle>No recent activity</EmptyTitle>
          <EmptyDescription>Deploys, restarts, and cert renewals appear here. Backend ships in Plan 6.</EmptyDescription>
        </Empty>
      </aside>
    </div>
  );
}
