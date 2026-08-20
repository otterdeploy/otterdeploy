/**
 * Shared constants + small presentational pieces for the route access
 * controls. Split out of route-access-controls.tsx (with the Guests section
 * in route-access-guests.tsx) to keep each file under the max-lines cap.
 *
 * Duration labels come from the `routeAccess.duration` i18n plurals, so the
 * option lists are hooks rather than module constants: one rule (whole days
 * read as days, anything shorter as hours) keeps guest sessions, link
 * expiries, and token lifetimes speaking the same language.
 */

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { copyToClipboard } from "@/shared/lib/clipboard";

// Mirrors the server's zod .email() so a bad address is flagged before the
// round-trip instead of returning a generic "Input validation failed" toast.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GUEST_HOURS = [1, 8, 24, 168, 720] as const;
const SHARE_LINK_HOURS = [24, 72, 168, 720] as const;
const BYPASS_TOKEN_DAYS = [30, 90, 180, 365] as const;

/** Hours → localized label: whole days as "{n} days", the rest as hours. */
export function useHoursLabel(): (hours: number) => string {
  const { t } = useTranslation();
  return (hours) =>
    hours % 24 === 0
      ? t("routeAccess.duration.day", { count: hours / 24 })
      : t("routeAccess.duration.hour", { count: hours });
}

// Base UI's <SelectValue> shows the selected value's *label* only when the
// root is given an items map; without it the trigger renders the raw value
// ("24"), so every picker below builds {label, value} pairs.

export function useGuestItems(): { label: string; value: string }[] {
  const label = useHoursLabel();
  return GUEST_HOURS.map((h) => ({ label: label(h), value: String(h) }));
}

export function useShareLinkItems(): { label: string; value: string }[] {
  const label = useHoursLabel();
  return SHARE_LINK_HOURS.map((h) => ({ label: label(h), value: String(h) }));
}

export function useBypassTokenItems(): { label: string; value: string }[] {
  const { t } = useTranslation();
  return BYPASS_TOKEN_DAYS.map((d) => ({
    label:
      d % 365 === 0
        ? t("routeAccess.duration.year", { count: d / 365 })
        : t("routeAccess.duration.day", { count: d }),
    value: String(d),
  }));
}

/** Small label + one-line description that heads each section. */
export function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-[13px] font-medium">{title}</Label>
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Shared duration picker ("Expires in <select>") keeps the link/token rows
 *  identical and makes the lifetime explicit before generating. */
export function DurationSelect({
  items,
  value,
  onChange,
}: {
  items: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-muted-foreground">{t("routeAccess.expiresIn")}</span>
      <Select items={items} value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="h-8 w-[104px] text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CopyField({ value, onReset }: { value: string; onReset?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className="h-8 font-mono text-[12px]" />
      <Button
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => {
          void copyToClipboard(value).then((ok) =>
            ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
          );
        }}
        aria-label={t("common.copy")}
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.8} className="size-3.5" />
      </Button>
      {onReset ? (
        <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={onReset}>
          {t("routeAccess.newCredential")}
        </Button>
      ) : null}
    </div>
  );
}
