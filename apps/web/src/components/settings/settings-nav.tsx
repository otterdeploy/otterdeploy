import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ServerStack01Icon,
  GitBranchIcon,
  Globe02Icon,
  DatabaseRestoreIcon,
  Audit01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@otterstack/ui/lib/utils";

type SettingsNavItem = {
  label: string;
  to: string;
  icon: IconSvgElement;
};

const items: SettingsNavItem[] = [
  { label: "Servers", to: "/settings/servers", icon: ServerStack01Icon },
  { label: "Git Providers", to: "/settings/git-providers", icon: GitBranchIcon },
  { label: "Domains", to: "/settings/domains", icon: Globe02Icon },
  { label: "Backups", to: "/settings/backups", icon: DatabaseRestoreIcon },
  { label: "Audit Log", to: "/settings/audit-log", icon: Audit01Icon },
];

export function SettingsNav() {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          )}
          activeProps={{
            className: "bg-muted text-foreground",
          }}
        >
          <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-4" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
