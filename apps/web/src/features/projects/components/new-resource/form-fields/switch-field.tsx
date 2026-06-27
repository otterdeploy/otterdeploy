import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Switch } from "@/shared/components/ui/switch";

import { useFieldContext } from "../form-context";

interface SwitchFieldProps {
  label: string;
  description?: string;
}

export function SwitchField({ label, description }: SwitchFieldProps) {
  const field = useFieldContext<boolean>();
  const errors = field.state.meta.errors;
  return (
    <Field>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <FieldLabel>{label}</FieldLabel>
          {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
        </div>
        <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
      </div>
      {errors.map((err, i) => (
        <FieldError key={i}>{String(err?.message ?? err)}</FieldError>
      ))}
    </Field>
  );
}
