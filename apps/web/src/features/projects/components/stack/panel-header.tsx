/**
 * Header strip for the StackCodePanel: tab switcher + collapse chevron.
 */

import { ArrowDown01Icon, ArrowUp01Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export type StackTab = "stack" | "activity" | "traffic";

export interface PanelHeaderProps {
  tab: StackTab;
  onTabChange: (t: StackTab) => void;
  open: boolean;
  onToggle: () => void;
  dirty: boolean;
}

export function PanelHeader({ tab, onTabChange, open, onToggle, dirty }: PanelHeaderProps) {
  return (
    <div className="flex h-10 items-center justify-between gap-2 border-b border-border/40 pr-3 pl-2">
      {/* The three tabs total ~230px and the collapse chevron must stay
          reachable, so the strip scrolls rather than squashing the chevron
          off the edge on a phone. */}
      <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
        <TabButton
          active={tab === "stack"}
          onClick={() => onTabChange("stack")}
          icon={CodeIcon}
          label="Stack code"
          badge={dirty ? "•" : undefined}
        />
        <TabButton
          active={tab === "activity"}
          onClick={() => onTabChange("activity")}
          label="Activity"
        />
        <TabButton
          active={tab === "traffic"}
          onClick={() => onTabChange("traffic")}
          label="Traffic"
        />
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowUp01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: typeof CodeIcon;
  badge?: string;
}

function TabButton({ active, onClick, label, icon, badge }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {icon && <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />}
      {label}
      {badge && <span className="text-amber-400">{badge}</span>}
    </button>
  );
}
