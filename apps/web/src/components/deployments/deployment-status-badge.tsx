import { Badge } from "@otterstack/ui/components/ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Queued", variant: "secondary" },
  building: { label: "Building", variant: "outline" },
  deploying: { label: "Deploying", variant: "outline" },
  live: { label: "Live", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  canceled: { label: "Canceled", variant: "secondary" },
  rolled_back: { label: "Rolled Back", variant: "outline" },
};

type DeploymentStatusBadgeProps = {
  status: string;
};

export function DeploymentStatusBadge({ status }: DeploymentStatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, variant: "secondary" as const };

  return (
    <Badge variant={config.variant}>
      {config.label}
    </Badge>
  );
}
