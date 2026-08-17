/**
 * Click-to-select cards, used for the SSH-key list and the connectivity
 * provider row on the Add-server dialog.
 *
 * Replaces two `Select`s. A native select showed nothing at all when its value
 * was the empty string (no placeholder, no hint that a choice was required)
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
  /** Secondary line: a fingerprint, a one-line explanation. */
  hint?: string;
  /** Brand mark or glyph. Monochrome; inherits color from the card. */
  icon?: ReactNode;
}

/**
 * A single opt-in block, for a capability that isn't one-of-a-set.
 *
 * Cloudflare Tunnel used to be a bare password input sitting under the mesh
 * choice, which read as a fourth connectivity option. It isn't. A tunnel is
 * ingress; the mesh is how the swarm join happens. This gives it the same
 * visual weight as the cards without implying they're alternatives, and hides
 * the token field until it's actually wanted.
 */
export function PickerToggle({
  label,
  hint,
  icon,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  hint?: string;
  icon?: ReactNode;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-left ring-1 transition-colors",
          enabled
            ? "bg-primary/[0.06] ring-primary/40"
            : "bg-muted/20 ring-foreground/10 hover:bg-muted/40",
        )}
      >
        {icon ? (
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center [&>svg]:size-full",
              enabled ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{label}</span>
          {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
        </span>
        <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
          {enabled ? (
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-4 text-primary" />
          ) : null}
        </span>
      </button>
      {enabled ? children : null}
    </div>
  );
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
  /** `auto` fits as many equal blocks per row as the options need, capped at 3.
   *  Keys and connectivity then read as the same kind of choice. */
  columns?: 1 | 3 | "auto";
}) {
  const cols =
    columns === "auto" ? (options.length === 1 ? 1 : Math.min(options.length, 3)) : columns;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <div
        className={cn(
          "grid gap-2",
          cols === 3 && "sm:grid-cols-3",
          cols === 2 && "sm:grid-cols-2",
          cols === 1 && "grid-cols-1",
        )}
      >
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
                    "flex size-5 shrink-0 items-center justify-center [&>svg]:size-full",
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
