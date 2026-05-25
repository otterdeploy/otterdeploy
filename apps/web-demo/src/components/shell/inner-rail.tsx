import { Link } from "@tanstack/react-router";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "@/lib/utils";
import { innerRailItems } from "./rail-items";

interface Props {
  projectId: string;
  currentHref: string;
}

function buildHref(projectId: string, segment: string): string {
  return segment === ""
    ? `/project/${projectId}`
    : `/project/${projectId}/${segment}`;
}

function isActive(
  itemHref: string,
  projectRoot: string,
  currentHref: string,
): boolean {
  if (itemHref === projectRoot) {
    return currentHref === projectRoot;
  }
  return currentHref === itemHref || currentHref.startsWith(itemHref + "/");
}

export function InnerRail({ projectId, currentHref }: Props) {
  const projectRoot = `/project/${projectId}`;
  return (
    <nav
      aria-label="Project navigation"
      className="flex h-full w-12 flex-col items-center gap-1 border-r border-border bg-sidebar py-3"
    >
      {innerRailItems.map((item) => {
        const Icon = item.icon;
        const href = buildHref(projectId, item.href);
        const active = isActive(href, projectRoot, currentHref);
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Link
                  to={href}
                  data-rail-item
                  data-id={item.id}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sidebar-foreground transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </Link>
              }
            />
            <TooltipPopup side="right">{item.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </nav>
  );
}
