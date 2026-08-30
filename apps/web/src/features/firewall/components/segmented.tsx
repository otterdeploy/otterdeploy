/**
 * The Firewall's segmented control: a row of mutually-exclusive options, each
 * able to carry a count.
 *
 * One component for the tab strip and for every filter, because the previous
 * arrangement had the tabs hand-rolling a strip that looked *almost* like the
 * shared `Segmented` beside it — same idea, two implementations, and they had
 * already drifted a pixel apart.
 *
 * Generic over the option type, so the callback hands back the literal it was
 * given and callers need no string guard to narrow it again.
 */
import { cn } from "@/shared/lib/utils";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Optional per-option count, rendered muted after the label. */
  counts?: Partial<Record<T, number>>;
  /** Display text, when the option's own value isn't what to show. */
  label?: (option: T) => string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-md border p-0.5"
    >
      {options.map((option) => {
        const active = value === option;
        const count = counts?.[option];
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {label ? label(option) : option}
            {count === undefined ? null : (
              <span className={cn("ml-1.5", active ? "text-muted-foreground" : "opacity-60")}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
