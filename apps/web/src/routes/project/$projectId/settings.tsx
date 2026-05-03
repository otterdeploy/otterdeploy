import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/project/$projectId/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Settings</EmptyTitle>
        <EmptyDescription>Long-scroll settings page with sticky TOC. Lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
