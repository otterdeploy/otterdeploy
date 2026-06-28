/**
 * Shared constants + small presentational pieces for the route access
 * controls. Split out of route-access-controls.tsx (with the Guests section
 * in route-access-guests.tsx) to keep each file under the max-lines cap.
 */

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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

// Mirrors the server's zod .email() so a bad address is flagged before the
// round-trip instead of returning a generic "Input validation failed" toast.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GUEST_DURATIONS = [
  { label: "1 hour", hours: 1 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

const SHARE_LINK_DURATIONS = [
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

const BYPASS_TOKEN_DURATIONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "1 year", days: 365 },
] as const;

// Base UI's <SelectValue> shows the selected value's *label* only when the root
// is given an items map; without it the trigger renders the raw value ("24").
export const GUEST_ITEMS = GUEST_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.hours),
}));
export const SHARE_LINK_ITEMS = SHARE_LINK_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.hours),
}));
export const BYPASS_TOKEN_ITEMS = BYPASS_TOKEN_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.days),
}));

/** Read-only label for an already-invited guest's session length. */
export function guestDurationLabel(hours: number): string {
  const known = GUEST_DURATIONS.find((d) => d.hours === hours);
  if (known) return known.label;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
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

/** Shared duration picker — "Expires in <select>" — keeps the link/token rows
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
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-muted-foreground">Expires in</span>
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
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className="h-8 font-mono text-[12px]" />
      <Button
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copied to clipboard");
        }}
        aria-label="Copy"
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.8} className="size-3.5" />
      </Button>
      {onReset ? (
        <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={onReset}>
          New
        </Button>
      ) : null}
    </div>
  );
}
