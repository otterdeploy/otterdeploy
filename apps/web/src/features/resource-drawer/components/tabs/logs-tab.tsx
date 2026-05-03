import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function LogsTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Logs</EmptyTitle>
        <EmptyDescription>Live log tail (Ghostty terminal) lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
