import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

interface HeaderBarProps {
  serviceCount: number;
  query: string;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onQueryChange: (v: string) => void;
  onAdd: () => void;
}

export function HeaderBar({
  serviceCount,
  query,
  searchOpen,
  onToggleSearch,
  onQueryChange,
  onAdd,
}: HeaderBarProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{serviceCount} Service Variables</span>
          <button
            type="button"
            onClick={onToggleSearch}
            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Search variables"
          >
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-3.5" />
          </button>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={onAdd}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          New Variable
        </Button>
      </div>

      {searchOpen && (
        <Input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by variable name…"
          className="h-9 font-mono text-[12.5px]"
        />
      )}
    </>
  );
}
