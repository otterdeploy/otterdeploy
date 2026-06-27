import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
/** Small labelled form-field primitives shared by the backups dialogs. */
import { cn } from "@/shared/lib/utils";

import { Field } from "./shared";

export interface SelectItemOption {
  label: string;
  value: string;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label}>
      <Input
        className={mono ? "font-mono" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  placeholder,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  min?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <Input
        className="font-mono"
        type="number"
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  placeholder,
  items,
  value,
  onChange,
  disabled,
  mono,
}: {
  label: string;
  placeholder?: string;
  items: SelectItemOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
        items={items}
        value={value}
        onValueChange={(v) => onChange(v ?? "")}
        disabled={disabled}
      >
        <SelectTrigger className={mono ? "font-mono" : undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup className="p-1.5">
            <SelectLabel className="px-2 pt-1 pb-1.5">{label}</SelectLabel>
            {items.map((it) => (
              <SelectItem
                key={it.value}
                value={it.value}
                className={cn("py-1.5 pl-2", mono && "font-mono")}
              >
                {it.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
