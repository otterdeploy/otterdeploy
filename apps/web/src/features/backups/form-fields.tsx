/** Small labelled form-field primitives shared by the backups dialogs. */
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

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
          {items.map((it) => (
            <SelectItem
              key={it.value}
              value={it.value}
              className={mono ? "font-mono" : undefined}
            >
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
