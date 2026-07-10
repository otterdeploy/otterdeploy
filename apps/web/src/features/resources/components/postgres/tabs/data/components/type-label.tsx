/**
 * Muted type-tone for column-type labels (Columns popover, Structure view, row
 * detail) — one quiet hue per type family, per the reference viewer. Tones stay
 * desaturated so the accent budget (DESIGN.md) is untouched.
 */

import { cn } from "@/shared/lib/utils";

export function typeToneClass(type: string): string {
  if (/bool/.test(type)) return "text-amber-600 dark:text-amber-500";
  if (/int|numeric|real|double|decimal|money|serial/.test(type)) {
    return "text-emerald-600 dark:text-emerald-500";
  }
  if (/json/.test(type)) return "text-purple-600 dark:text-purple-400";
  if (/uuid/.test(type)) return "text-sky-600 dark:text-sky-500";
  return "text-muted-foreground";
}

/** Small mono type label, tone-colored ("varchar", "int4", …). */
export function TypeLabel({ type, className }: { type: string; className?: string }) {
  return (
    <span className={cn("font-mono text-[10px]", typeToneClass(type), className)}>{type}</span>
  );
}
