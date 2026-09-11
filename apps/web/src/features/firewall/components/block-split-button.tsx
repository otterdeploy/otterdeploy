/**
 * Block, with a length.
 *
 * One click is one block at the default thirty days; the caret is for the times
 * that is not the answer, so choosing "forever" or "1 hour" never costs a click
 * to reach. `BAN_DURATIONS` is the only list of lengths in the app, so no two
 * surfaces can disagree about what "7 days" means or which lengths exist.
 *
 * Extracted from `FlaggedRowAction`, which had this shape first and had it
 * right. It is here rather than there because three surfaces need it now — the
 * flagged panel, the access log's rows, and the access log's bulk action — and
 * the third copy is the one that would have drifted.
 *
 * Presentational on purpose: it takes `onBlock(hours)` rather than reaching for
 * the firewall mutations itself, because the access log blocks through
 * `useEdgeBans` and the firewall panels through `useFirewallActions`.
 */

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { BAN_DURATIONS } from "@/features/firewall/ban-durations";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

/** Blocking is destructive, but on these surfaces it is also the ORDINARY
 *  thing to do, so it must not shout once per row. */
const DESTRUCTIVE = "text-destructive hover:text-destructive";

export function BlockSplitButton({
  label,
  menuLabel,
  onBlock,
  disabled = false,
  size = "xs",
  className,
}: {
  /** The main button's word — "Block", or "Block 98 IPs" in bulk. */
  label: string;
  /** Accessible name for the caret, which otherwise reads as a bare glyph. */
  menuLabel: string;
  /** `hours` is undefined for the default length. */
  onBlock: (hours?: number) => void;
  disabled?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <span className={cn("inline-flex items-center", className)}>
      <Button
        variant="outline"
        size={size}
        disabled={disabled}
        className={cn("rounded-r-none border-r-0 whitespace-nowrap", DESTRUCTIVE)}
        onClick={() => onBlock()}
      >
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size={size}
              disabled={disabled}
              aria-label={menuLabel}
              className={cn("rounded-l-none px-1", DESTRUCTIVE)}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>{t("firewall.banDuration")}</DropdownMenuLabel>
          {BAN_DURATIONS.map((duration) => (
            <DropdownMenuItem key={duration.hours} onClick={() => onBlock(duration.hours)}>
              {t(duration.labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
