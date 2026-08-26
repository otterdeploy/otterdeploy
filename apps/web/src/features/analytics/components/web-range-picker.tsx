/**
 * The dashboard's window control: one quiet popover holding the nine presets,
 * a calendar for "that launch week in March", and the compare toggle. Day
 * math is Temporal in the viewer's timezone; `Date` exists only at the
 * react-day-picker seam and is converted the moment it crosses back.
 */

import { useState } from "react";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";
import { type DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { CLOCK_DAY, clockFormatter, epochMsOf } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

import { BROWSER_TZ } from "../hooks/use-web-analytics";
import { dayEndMs, dayStartMs, RANGE_KEYS, RANGE_LABEL_KEYS, type RangeKey } from "../lib/range";

const dayLabel = clockFormatter(CLOCK_DAY);

/** react-day-picker demands Date at its prop seam; constructed here only and
 *  read back through epochMsOf immediately. */
function dateAt(ms: number): Date {
  return new Date(ms);
}

export interface RangeSelection {
  range: RangeKey;
  from?: number;
  to?: number;
}

const PRESETS: readonly RangeKey[] = RANGE_KEYS.filter((key) => key !== "custom");

export function WebRangePicker({
  value,
  compare,
  onChange,
  onCompareChange,
}: {
  value: RangeSelection;
  compare: boolean;
  onChange: (next: RangeSelection) => void;
  onCompareChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const label =
    value.range === "custom" && value.from !== undefined && value.to !== undefined
      ? `${dayLabel(value.from)} – ${dayLabel(value.to)}`
      : t(RANGE_LABEL_KEYS[value.range]);

  const apply = (next: RangeSelection) => {
    onChange(next);
    setOpen(false);
    setPicking(false);
  };

  const draftComplete = draft?.from !== undefined && draft.to !== undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicking(false);
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8 gap-1.5" />}>
        <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3.5" />
        <span className="text-xs">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-44 p-0">
        {picking ? (
          <div className="flex flex-col gap-2 p-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              disabled={{ after: dateAt(Temporal.Now.instant().epochMilliseconds) }}
              defaultMonth={draft?.from}
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {draftComplete && draft.from && draft.to
                  ? `${dayLabel(epochMsOf(draft.from))} – ${dayLabel(epochMsOf(draft.to))}`
                  : t("analytics.range.pickDays")}
              </span>
              <Button
                size="sm"
                disabled={!draftComplete}
                onClick={() => {
                  if (!draft?.from || !draft.to) return;
                  const nowMs = Temporal.Now.instant().epochMilliseconds;
                  apply({
                    range: "custom",
                    from: dayStartMs(epochMsOf(draft.from), BROWSER_TZ),
                    to: dayEndMs(epochMsOf(draft.to), BROWSER_TZ, nowMs),
                  });
                }}
              >
                {t("analytics.range.apply")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col p-1" role="listbox" aria-label={t("analytics.range.aria")}>
            {PRESETS.map((key) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={value.range === key}
                onClick={() => apply({ range: key })}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  value.range === key && "bg-muted font-medium",
                )}
              >
                {t(RANGE_LABEL_KEYS[key])}
              </button>
            ))}
            <button
              type="button"
              role="option"
              aria-selected={value.range === "custom"}
              onClick={() => {
                setPicking(true);
                setDraft(
                  value.from !== undefined && value.to !== undefined
                    ? { from: dateAt(value.from), to: dateAt(value.to) }
                    : undefined,
                );
              }}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                value.range === "custom" && "bg-muted font-medium",
              )}
            >
              {t("analytics.range.custom")}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
          <Checkbox
            id="analytics-compare"
            checked={compare}
            onCheckedChange={(next) => onCompareChange(next === true)}
          />
          <Label htmlFor="analytics-compare" className="text-xs font-normal">
            {t("analytics.range.compare")}
          </Label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
