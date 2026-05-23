import { Link } from "@tanstack/react-router";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "@/lib/utils";
import { outerRailItems, type RailItem } from "./rail-items";

type Props = {
  currentHref: string;
};

function isActive(item: RailItem, currentHref: string): boolean {
  if (item.href === "/") {
    return currentHref === "/" || currentHref.startsWith("/project");
  }
  return currentHref === item.href || currentHref.startsWith(item.href + "/");
}

export function OuterRail({ currentHref }: Props) {
  return (
    <nav
      aria-label="Workspace navigation"
      className="flex h-full w-12 flex-col items-center gap-1 border-r border-border bg-sidebar py-3"
    >
      {outerRailItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item, currentHref);
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Link
                  to={item.href}
                  data-rail-item
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
