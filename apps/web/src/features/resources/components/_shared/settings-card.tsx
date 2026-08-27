/**
 * Reusable card + read-only-row primitives for the postgres settings tab.
 * Kept inside this folder because nothing else uses them. When another
 * settings surface shares them they can promote to ../atoms.
 */

import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { sectionId, usePanelSection } from "@/features/resources/components/_shared/panel-sections";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  // Registering here is what puts this card in the rail's table of contents
  // when the panel is expanded. Every settings surface gets it without
  // per-tab wiring; a card added later appears on its own.
  const register = usePanelSection(title);
  return (
    <section id={sectionId(title)} ref={register} className="flex scroll-mt-6 flex-col gap-2.5">
      <div>
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px] text-muted-foreground/80">{description}</div>
        )}
      </div>
      <div className="overflow-hidden rounded-md border bg-card">{children}</div>
    </section>
  );
}

export function SettingsRowReadOnly({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  /** When set, the value renders as a clickable link opening in a new tab. */
  href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  const valueClasses = "min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground";
  return (
    <div className="group flex items-center gap-4 border-b border-border/40 px-3 py-2.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "min-w-0 flex-1 font-mono text-[12.5px] break-all",
            // Always reads as a link: bright foreground text + permanent
            // underline + pointer cursor. The underline sits muted and
            // brightens to full foreground on hover for interactive feedback.
            "cursor-pointer text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground",
          )}
        >
          {value}
        </a>
      ) : (
        <span className={valueClasses}>{value}</span>
      )}
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : `Copy ${label}`}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded transition-opacity",
          copied
            ? "text-primary opacity-100"
            : "text-muted-foreground/70 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}
