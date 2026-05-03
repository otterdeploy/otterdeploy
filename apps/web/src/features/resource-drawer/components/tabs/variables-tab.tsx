import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function VariablesTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Variables</EmptyTitle>
        <EmptyDescription>Shared and resource-scoped env vars land in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
