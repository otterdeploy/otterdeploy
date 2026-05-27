/**
 * Single-line variable rows used by the postgres Variables tab.
 *
 * `PostgresVarRow` is the dense one-line row for the "Service Variables"
 * card (the engine identity envs). `PostgresSystemVarRow` is the looser
 * two-line treatment for the collapsible "added by otterstack" section
 * where each var carries a description.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  InformationCircleIcon,
  MoreVerticalIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/shared/lib/utils";

interface RowProps {
  v: { name: string; value: string; secret: boolean; description?: string };
  revealed: boolean;
  copied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
}

export function PostgresVarRow({
  v,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: RowProps) {
  const display = v.secret && !revealed ? "•••••••" : v.value;
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5">
      <span className="font-mono text-[11px] text-muted-foreground/50">
        {`{}`}
      </span>
      <span className="w-56 truncate font-mono text-[12.5px] text-foreground/90">
        {v.name}
      </span>
      <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground">
        {display}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {v.secret && (
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={revealed ? "Hide value" : "Reveal value"}
            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon
              icon={revealed ? ViewOffIcon : ViewIcon}
              strokeWidth={2}
              className="size-3.5"
            />
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : `Copy ${v.name}`}
          className={cn(
            "grid size-7 place-items-center rounded transition-colors",
            copied
              ? "text-primary"
              : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
          )}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </button>
        <button
          type="button"
          aria-label="Variable info"
          className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-3.5"
          />
        </button>
      </div>
      <button
        type="button"
        aria-label="More actions"
        className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon
          icon={MoreVerticalIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}

export function PostgresSystemVarRow({
  v,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: RowProps) {
  const display = v.secret && !revealed ? "•••••••" : v.value;
  return (
    <div className="group flex items-start gap-3 border-b border-border/30 py-3 last:border-b-0">
      <div className="flex w-56 flex-col gap-0.5">
        <span className="font-mono text-[12px] text-foreground/90">{v.name}</span>
        {v.description && (
          <span className="text-[11.5px] leading-snug text-muted-foreground/80">
            {v.description}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-1 items-center gap-1.5">
        <span className="truncate rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] text-muted-foreground">
          {display}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {v.secret && (
            <button
              type="button"
              onClick={onToggleReveal}
              aria-label={revealed ? "Hide value" : "Reveal value"}
              className="grid size-6 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={revealed ? ViewOffIcon : ViewIcon}
                strokeWidth={2}
                className="size-3"
              />
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? "Copied" : `Copy ${v.name}`}
            className={cn(
              "grid size-6 place-items-center rounded transition-colors",
              copied
                ? "text-primary"
                : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
              className="size-3"
            />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="mt-0.5 shrink-0 rounded border border-border/50 bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        Reference
      </button>
    </div>
  );
}
