import { LogsTerminal } from "@/features/logs-terminal";

type Props = {
  projectId: string;
  resourceId: string;
  resourceName: string;
};

export function LogsTab({ projectId, resourceId, resourceName }: Props) {
  return (
    <div className="h-[calc(100vh-220px)] min-h-[320px]">
      <LogsTerminal scope={{ kind: "resource", projectId, resourceId, resourceName }} />
    </div>
  );
}
