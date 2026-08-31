/**
 * "Block an IP by hand": a popover holding the field, the ban length and the
 * submit, behind one toolbar button.
 *
 * It used to be three inline controls (a 176px input, a 112px select, a
 * button) living in the toolbar. That is ~380px of chrome that only the
 * Blocked tab could use, it pushed every other control off the row, and on a
 * phone it wrapped into three stacked lines above the table. Folding it into a
 * popover gives the action one fixed-width button at every viewport and lets
 * the form be laid out for reading rather than for squeezing.
 */
import { useState } from "react";

import { AddCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { BAN_DURATIONS } from "../ban-durations";
import { DEFAULT_BAN_HOURS } from "../decisions";

export function BlockIpAction({
  onBlock,
}: {
  onBlock: (ip: string, durationHours: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Rebuilt when the language changes; `Select` values round-trip as strings.
  const items = BAN_DURATIONS.map((d) => ({ value: String(d.hours), label: t(d.labelKey) }));
  const form = useForm({
    defaultValues: { ip: "", hours: DEFAULT_BAN_HOURS },
    onSubmit: ({ value, formApi }) => {
      const ip = value.ip.trim();
      if (!ip) return;
      onBlock(ip, value.hours);
      formApi.setFieldValue("ip", "");
      setOpen(false);
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={AddCircleIcon} strokeWidth={2} className="size-3.5" />
            {t("firewall.block")} IP
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] gap-3 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="ip">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="firewall-block-ip" className="text-[13px]">
                  {t("firewall.blockAria")}
                </Label>
                <Input
                  id="firewall-block-ip"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("firewall.blockPlaceholder")}
                  className="font-mono text-xs"
                />
              </div>
            )}
          </form.Field>
          <form.Field name="hours">
            {(field) => (
              // Values round-trip as strings through the control, so the
              // field's number is stringified in and parsed out.
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="firewall-block-duration" className="text-[13px]">
                  {t("firewall.banDuration")}
                </Label>
                <Select
                  value={String(field.state.value)}
                  onValueChange={(next) => field.handleChange(Number(next))}
                  items={items}
                >
                  <SelectTrigger id="firewall-block-duration" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          {/* No pending state: the ban is applied optimistically the moment
              the form is submitted, and the popover closes on the same tick. */}
          <form.Subscribe selector={(s) => s.values.ip.trim().length === 0}>
            {(empty) => (
              <Button type="submit" size="sm" disabled={empty}>
                {t("firewall.block")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </PopoverContent>
    </Popover>
  );
}
