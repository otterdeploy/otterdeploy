import { Link, useParams } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  HierarchyCircle02Icon,
  Rocket01Icon,
  Key01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@otterstack/ui/lib/utils";

type Tab = {
  label: string;
  segment: string;
  icon: IconSvgElement;
};

const tabs: Tab[] = [
  { label: "Architecture", segment: "architecture", icon: HierarchyCircle02Icon },
  { label: "Deployments", segment: "deployments", icon: Rocket01Icon },
  { label: "Env Vars", segment: "env-vars", icon: Key01Icon },
  { label: "Settings", segment: "settings", icon: Wrench01Icon },
];

export function ProjectTabs() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId;

  if (!projectId) return null;

  return (
    <nav className="flex gap-1 border-b px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.segment}
          to={`/projects/${projectId}/${tab.segment}`}
          className={cn(
            "flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
          )}
          activeProps={{
            className: "border-primary text-foreground",
          }}
        >
          <HugeiconsIcon icon={tab.icon} strokeWidth={2} className="size-4" />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
