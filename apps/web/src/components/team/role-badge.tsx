import { Badge } from "@otterstack/ui/components/ui/badge";

const roleConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline" }> = {
  owner: { variant: "default" },
  admin: { variant: "secondary" },
  member: { variant: "outline" },
  viewer: { variant: "outline" },
};

type RoleBadgeProps = {
  role: string;
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const config = roleConfig[role] ?? { variant: "outline" as const };

  return (
    <Badge variant={config.variant} className="capitalize">
      {role}
    </Badge>
  );
}
