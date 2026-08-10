import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

/** Labeled text input shared by the sign-in / sign-up forms. */
function AuthInput({
  id,
  name,
  label,
  type,
  autoComplete,
  placeholder,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <>
      <Label
        htmlFor={id}
        className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
      >
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="h-11 rounded-lg bg-muted px-3.5"
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

/** Full-width primary submit button with a spinner while pending. */
export function AuthSubmitButton({
  disabled,
  pending,
  idleLabel,
  pendingLabel,
}: {
  disabled: boolean;
  pending: boolean;
  idleLabel: string;
  pendingLabel: string;
}) {
  return (
    <Button
      type="submit"
      className="h-11 w-full rounded-lg bg-foreground font-semibold text-background hover:bg-foreground/90"
      disabled={disabled}
    >
      {pending ? (
        <>
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>{idleLabel}</>
      )}
    </Button>
  );
}

/**
 * A labelled input plus its validation errors, driven by a TanStack Form field.
 *
 * The sign-in and sign-up forms repeated this exact div/AuthInput/errors block
 * once per field (six times between them) which pushed SignUpForm to 192
 * lines and SignInForm to 153, both over the 150-line cap, and buried the parts
 * that actually differ (label, type, autocomplete) in identical scaffolding.
 */
export function AuthField({
  field,
  label,
  type,
  autoComplete,
  placeholder,
  hint,
}: {
  // Structural rather than TanStack's generic FieldApi: typing it fully would
  // mean threading each form's whole value shape through for no added safety
  // at this call site.
  field: {
    name: string;
    state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
  label: string;
  type?: string;
  autoComplete: string;
  placeholder: string;
  /** Explanatory text under the input, before any validation errors. */
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <AuthInput
        id={field.name}
        name={field.name}
        label={label}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={field.handleChange}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {field.state.meta.errors.map((error) => (
        <p key={error?.message} className="text-sm text-destructive">
          {error?.message}
        </p>
      ))}
    </div>
  );
}
