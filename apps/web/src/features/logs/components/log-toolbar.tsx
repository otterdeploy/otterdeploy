/**
 * Toolbar for {@link LogViewer}: copy, a line/match count, per-severity match
 * navigators (error/warn — step through matches with 1/N + ↑/↓, keeping every
 * line in view), and a "find in logs" box. Split out so the viewer file stays
 * focused on the scroller + state.
 */

import type { RefObject } from "react";

import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  CancelCircleIcon,
  Copy01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export type NavLevel = "error" | "warn";

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function LogToolbar({
  countLabel,
  errorCount,
  warnCount,
  activeLevel,
  navIndex,
  onActivate,
  onStep,
  query,
  onQueryChange,
  searchRef,
  onCopy,
}: {
  countLabel: string;
  errorCount: number;
  warnCount: number;
  activeLevel: NavLevel | null;
  /** 0-based position of the current match (only meaningful while stepping). */
  navIndex: number;
  onActivate: (level: NavLevel) => void;
  onStep: (dir: 1 | -1) => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy logs"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
      </button>
      <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
        {countLabel}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <LevelChip
          icon={CancelCircleIcon}
          count={errorCount}
          tone="error"
          active={activeLevel === "error"}
          index={navIndex}
          onActivate={() => onActivate("error")}
          onStep={onStep}
        />
        <LevelChip
          icon={Alert02Icon}
          count={warnCount}
          tone="warn"
          active={activeLevel === "warn"}
          index={navIndex}
          onActivate={() => onActivate("warn")}
          onStep={onStep}
        />
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Find in logs"
            placeholder="Find in logs"
            className="h-7 w-44 rounded-md border bg-transparent pr-9 pl-8 font-mono text-[11.5px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-foreground/20"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/50">
            ⌘F
          </kbd>
        </div>
      </div>
    </div>
  );
}

function LevelChip({
  icon,
  count,
  tone,
  active,
  index,
  onActivate,
  onStep,
}: {
  icon: typeof CancelCircleIcon;
  count: number;
  tone: NavLevel;
  active: boolean;
  index: number;
  onActivate: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const disabled = count === 0;
  const stepping = active && count > 0;
  const label = tone === "error" ? "error" : "warning";
  const toneActive =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-warning/40 bg-warning/10 text-warning";
  const toneIdle = tone === "error" ? "text-destructive/80" : "text-warning/80";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border font-mono text-[11px] tabular-nums transition-colors",
        disabled
          ? "border-transparent text-muted-foreground/40"
          : active
            ? toneActive
            : cn("border-border/60", toneIdle),
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        disabled={disabled}
        aria-pressed={active}
        title={`${count} ${label} ${plural(count, "line")}${disabled ? "" : active ? " — click to clear" : " — click to step through"}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2",
          stepping ? "pr-1.5" : "pr-2",
          !disabled && !active && "hover:bg-muted",
        )}
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
        {stepping ? `${index + 1}/${count}` : count}
      </button>
      {stepping && (
        <div className="mr-1 flex items-center gap-0.5 border-l border-current/25 pl-1">
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label={`Previous ${label}`}
            className="grid size-4 place-items-center rounded hover:bg-current/15"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label={`Next ${label}`}
            className="grid size-4 place-items-center rounded hover:bg-current/15"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}
