import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

import { useFieldContext } from "../form-hook-contexts";

interface TextFieldProps {
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  description?: string;
  className?: string;
}

export function TextField({
  label,
  type = "text",
  placeholder,
  description,
  className,
}: TextFieldProps) {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={errors.length > 0}
        className={className}
      />
      {description && <div className="mt-1 text-[11px] text-muted-foreground">{description}</div>}
      {errors.map((err) => (
        <FieldError key={String(err?.message ?? err)}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
