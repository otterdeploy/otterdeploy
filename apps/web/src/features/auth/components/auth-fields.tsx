import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

/** Labeled text input shared by the sign-in / sign-up forms. */
export function AuthInput({
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
