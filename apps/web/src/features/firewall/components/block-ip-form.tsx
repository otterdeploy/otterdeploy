/**
 * The toolbar's "block an IP by hand" form, bans the entered IP/CIDR via
 * CrowdSec for a chosen duration.
 *
 * Split out of ./firewall-view so that file stays the view's layout and data
 * wiring: this is the one piece of it that owns form state, and the duration
 * list grows whenever we offer another ban length.
 */

import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

/**
 * Ban lengths offered by the manual block form (hours).
 *
 * Labels are i18n keys, not text: "7 days" pluralises and declines
 * differently per language, so the string has to be resolved at render.
 */
const BLOCK_DURATIONS = [
  { hours: 1, labelKey: "firewall.duration.hour1" },
  { hours: 24, labelKey: "firewall.duration.hours24" },
  { hours: 168, labelKey: "firewall.duration.days7" },
  { hours: 720, labelKey: "firewall.duration.days30" },
  { hours: 4320, labelKey: "firewall.duration.days180" },
] as const;

export function BlockIpForm({
  onBlock,
  blocking,
}: {
  onBlock: (ip: string, durationHours: number) => void;
  blocking: boolean;
}) {
  const { t } = useTranslation();
  // Rebuilt when the language changes; `Select` values round-trip as strings.
  const items = BLOCK_DURATIONS.map((d) => ({ value: String(d.hours), label: t(d.labelKey) }));
  const form = useForm({
    defaultValues: { ip: "", hours: 720 },
    onSubmit: ({ value, formApi }) => {
      const ip = value.ip.trim();
      if (!ip) return;
      onBlock(ip, value.hours);
      formApi.setFieldValue("ip", "");
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex items-center gap-1.5"
    >
      <form.Field name="ip">
        {(field) => (
          <Input
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder={t("firewall.blockPlaceholder")}
            aria-label={t("firewall.blockAria")}
            className="h-8 w-44 font-mono text-[12px]"
          />
        )}
      </form.Field>
      <form.Field name="hours">
        {(field) => (
          // Values round-trip as strings through the control, so the field's
          // number is stringified on the way in and parsed on the way out.
          <Select
            value={String(field.state.value)}
            onValueChange={(next) => field.handleChange(Number(next))}
            items={items}
          >
            <SelectTrigger aria-label={t("firewall.banDuration")} className="w-28 text-[12px]">
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
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.ip.trim().length === 0}>
        {(empty) => (
          <Button type="submit" variant="outline" size="sm" disabled={blocking || empty}>
            {blocking ? t("firewall.blocking") : t("firewall.block")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
