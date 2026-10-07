/**
 * A single choice among a few options, drawn as a segmented control and
 * exposed as a radio group. Split from ./shared for file size.
 */
import { cn } from "@/shared/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
  /** Accessible name of the choice ("Source", "Backup type"). */
  label: string;
}) {
  // A single choice among a few: a radio group, so assistive tech reads
  // "Database, radio button, 1 of 2, checked" instead of a row of unnamed
  // buttons. Arrow keys move the choice, one tab stop for the group.
  const move = (target: HTMLElement, from: number, step: number) => {
    const to = (from + step + options.length) % options.length;
    const next = options[to];
    if (!next) return;
    onChange(next.id);
    // Focus follows the choice, as in a native radio group.
    target.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5"
    >
      {options.map((o, index) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(e.currentTarget, index, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(e.currentTarget, index, -1);
              }
            }}
            className={cn(
              "rounded px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
