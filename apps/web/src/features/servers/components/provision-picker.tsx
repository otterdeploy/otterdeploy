/**
 * Click-to-select cards, used for the SSH-key list and the connectivity
 * provider row on the Add-server dialog.
 *
 * Replaces two `Select`s. A native select showed nothing at all when its value
 * was the empty string — no placeholder, no hint that a choice was required —
 * so the SSH key field rendered blank even with a usable key on file, and the
 * form submitted with no credential. Options you can see are options you can
 * pick.
 *
 * Radio semantics, not buttons: one choice out of a set, arrow-key navigable,
 * announced as a group.
 */

import type { ReactNode } from "react";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  /** Secondary line — a fingerprint, a one-line explanation. */
  hint?: string;
  /** Brand mark or glyph. Monochrome; inherits color from the card. */
  icon?: ReactNode;
}

export function PickerGroup({
  label,
  options,
  value,
  onChange,
  columns = 1,
}: {
  label: string;
  options: readonly PickerOption<string>[];
  value: string;
  onChange: (value: string) => void;
  columns?: 1 | 3;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <div className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "grid-cols-1")}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2.5 text-left ring-1 transition-colors",
                selected
                  ? "bg-primary/[0.06] ring-primary/40"
                  : "bg-muted/20 ring-foreground/10 hover:bg-muted/40",
              )}
            >
              {option.icon ? (
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {option.icon}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">{option.label}</span>
                {option.hint ? (
                  <span className="truncate text-[11px] text-muted-foreground">{option.hint}</span>
                ) : null}
              </span>
              <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
                {selected ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    strokeWidth={2.5}
                    className="size-4 text-primary"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
