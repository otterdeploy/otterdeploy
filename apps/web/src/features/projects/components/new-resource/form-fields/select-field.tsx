import { useFieldContext } from "../form-context";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/shared/components/ui/select";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectFieldProps {
  label: string;
  items: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function SelectField({ label, items, placeholder, className }: SelectFieldProps) {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(v) => typeof v === "string" && field.handleChange(v)}
        items={items}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
