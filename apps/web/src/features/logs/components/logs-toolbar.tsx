import {
  Copy01Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
  TextWrapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import { LEVEL_TEXT, LOG_LEVELS, type LogLevel } from "../data/use-project-log-stream";

export interface StatusBadge {
  label: string;
  dot: string;
  tone: string;
}

interface LogsToolbarProps {
  services: { id: string; name: string }[];
  svcFilter: string;
  onSvcChange: (id: string) => void;
  lvlFilter: Set<LogLevel>;
  onToggleLevel: (lv: LogLevel) => void;
  query: string;
  onQueryChange: (q: string) => void;
  badge: StatusBadge;
  wrap: boolean;
  onToggleWrap: () => void;
  paused: boolean;
  onTogglePause: () => void;
  onCopy: () => void;
  selectedCount?: number;
  onCopySelected?: () => void;
  onClearSelection?: () => void;
}

export function LogsToolbar({
  services,
  svcFilter,
  onSvcChange,
  lvlFilter,
  onToggleLevel,
  query,
  onQueryChange,
  badge,
  wrap,
  onToggleWrap,
  paused,
  onTogglePause,
  onCopy,
  selectedCount = 0,
  onCopySelected,
  onClearSelection,
}: LogsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <Select value={svcFilter} onValueChange={(v) => v && onSvcChange(v)}>
        <SelectTrigger className="h-8 w-44 text-[12px]" size="sm">
          <SelectValue placeholder="All services" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All services</SelectItem>
          {services.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
        {LOG_LEVELS.map((lv) => {
          const on = lvlFilter.has(lv);
          return (
            <button
              key={lv}
              type="button"
              onClick={() => onToggleLevel(lv)}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[11px] transition-colors",
                on
                  ? cn("bg-background font-medium shadow-sm", LEVEL_TEXT[lv])
                  : "text-muted-foreground/60 hover:text-foreground/80",
              )}
            >
              {lv}
            </button>
          );
        })}
      </div>

      <div className="relative max-w-95 flex-1">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="filter visible messages…"
          className="h-8 pl-8 font-mono text-[12px]"
        />
      </div>

      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-widest uppercase",
          badge.tone,
        )}
      >
        <span className={cn("size-1.5 rounded-full", badge.dot)} />
        {badge.label}
      </span>

      <div className="flex-1" />

      {selectedCount > 0 && (
        <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-[11px]">
          <span className="font-medium text-foreground">{selectedCount} selected</span>
          <button
            type="button"
            onClick={onCopySelected}
            className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 gap-1.5 text-[12px]", !wrap && "text-muted-foreground/60")}
        onClick={onToggleWrap}
      >
        <HugeiconsIcon icon={TextWrapIcon} strokeWidth={2} className="size-3.5" />
        Wrap
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-[12px]"
        onClick={onTogglePause}
      >
        <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} className="size-3.5" />
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy visible lines"
        onClick={onCopy}
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}
