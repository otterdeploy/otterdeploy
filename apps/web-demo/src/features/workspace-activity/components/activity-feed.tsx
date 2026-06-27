import { ActivityIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

export function ActivityFeed() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Audit trail across this workspace.</p>
      </div>

      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>All actors</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All kinds</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Last 24h</ToolbarButton>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled>
          Export
        </Button>
      </Toolbar>

      <Empty>
        <ActivityIcon className="size-6" />
        <EmptyTitle>No activity yet</EmptyTitle>
        <EmptyDescription>
          The audit log records every deploy, resource change, and admin action. Backend ships in
          Plan 6.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
