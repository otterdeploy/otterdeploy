/**
 * The toolbar's "block an IP by hand" form — bans the entered IP/CIDR via
 * CrowdSec for a chosen duration.
 *
 * Split out of ./firewall-view so that file stays the view's layout and data
 * wiring: this is the one piece of it that owns form state, and the duration
 * list grows whenever we offer another ban length.
 */

import { useForm } from "@tanstack/react-form";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

/** Ban lengths offered by the manual block form (hours). */
const BLOCK_DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 4320, label: "180 days" },
] as const;

/** The same durations shaped for Select, whose values are strings. Built once
 *  so the trigger's label lookup isn't rebuilt on every keystroke in the IP
 *  field beside it. */
const BLOCK_DURATION_ITEMS = BLOCK_DURATIONS.map((d) => ({
  value: String(d.hours),
  label: d.label,
}));

export function BlockIpForm({
  onBlock,
  blocking,
}: {
  onBlock: (ip: string, durationHours: number) => void;
  blocking: boolean;
}) {
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
            placeholder="Block IP or CIDR…"
            aria-label="Block an IP or CIDR range"
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
            items={BLOCK_DURATION_ITEMS}
          >
            <SelectTrigger aria-label="Ban duration" className="w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLOCK_DURATION_ITEMS.map((item) => (
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
            {blocking ? "Blocking…" : "Block"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
