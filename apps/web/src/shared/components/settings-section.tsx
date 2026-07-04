/**
 * Settings section — the shared shell for a configuration group: an iconned
 * uppercase eyebrow + description, then a hairline-ringed card body. One
 * consistent rhythm for every settings surface (edge global options, workspace
 * settings, …) so they stop hand-rolling slightly-different section markup.
 *
 * On-spec per DESIGN.md: flat card separated by `ring-1 ring-foreground/10`
 * (not a border, no shadow), warm-neutral, the accent reserved for actions.
 */

import type { ComponentProps, ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

export function SettingsSection({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: HugeIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start gap-2.5">
        {icon && (
          <span className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/10">
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground/80">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting inside a {@link SettingsSection} card: name + description on the
 * left, its control on the right. Rows self-divide with a hairline. Pass
 * `stacked` for a wide control (a full-width input) that sits below the label.
 */
export function SettingsRow({
  title,
  description,
  control,
  stacked = false,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 px-4 py-3.5",
        stacked ? "flex-col" : "items-center justify-between",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        {description && (
          <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <div className={cn("shrink-0", stacked && "w-full")}>{control}</div>
    </div>
  );
}

/** Right-aligned footer bar inside a section card — for a Save/apply action. */
export function SettingsFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 bg-muted/20 px-4 py-3">{children}</div>
  );
}
