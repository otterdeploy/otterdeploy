import { cn } from "@/lib/utils";
import type { SettingsSection } from "../types";

type Props = {
  sections: ReadonlyArray<SettingsSection>;
  activeId: string;
  onJump: (id: string) => void;
};

export function TocSidebar({ sections, activeId, onJump }: Props) {
  return (
    <nav aria-label="Settings sections" className="sticky top-3 grid gap-1 self-start text-sm">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onJump(section.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-left transition-colors",
            section.id === activeId
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
