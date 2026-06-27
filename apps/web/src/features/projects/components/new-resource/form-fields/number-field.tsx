import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

import { useFieldContext } from "../form-context";

interface NumberFieldProps {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function NumberField({ label, min, max, step, className }: NumberFieldProps) {
  const field = useFieldContext<number>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(Number(e.target.value))}
        aria-invalid={errors.length > 0}
        className={className}
      />
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
