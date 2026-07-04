import type { ComponentProps, ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];

/**
 * Consistent frame for a single wizard step: a tonal icon tile, the step title
 * and a short description, then the step's own form. Fills the content column
 * (`flex-1`) so each step's footer anchors to the same baseline and the card
 * never resizes between steps. The fade/slide keeps the transition legible
 * without shouting; suppressed under `prefers-reduced-motion`.
 */
export function StepFrame({
  icon,
  title,
  description,
  children,
}: {
  icon: IconType;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-7 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in-0 motion-safe:slide-in-from-right-1">
      <div className="flex flex-col gap-4">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-foreground/[0.06] text-foreground ring-1 ring-foreground/10">
          <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-[18px]" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
          <p className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Mono uppercase field label with a crisp Signal-Blue focus ring (the app's
 *  default `--ring` is a warm grey; onboarding leads with the brand accent). */
export function WizardField({
  id,
  label,
  value,
  onChange,
  onBlur,
  errors,
  placeholder,
  focusOnMount,
  autoComplete,
  hint,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  errors?: string[];
  placeholder?: string;
  focusOnMount?: boolean;
  autoComplete?: string;
  /** Optional helper line rendered under the input. */
  hint?: ReactNode;
  /** Render the value in Geist Mono (slugs, domains — machine-readable). */
  mono?: boolean;
}) {
  return (
    <Field>
      <FieldLabel
        htmlFor={id}
        className="font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase"
      >
        {label}
      </FieldLabel>
      <Input
        id={id}
        name={id}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a full-screen wizard step
        autoFocus={focusOnMount}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={cn(
          "h-11 rounded-lg border-input bg-input/30 px-3.5 shadow-none",
          "focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20",
          mono && "font-mono text-[0.8125rem]",
        )}
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <div className="pt-1">{hint}</div> : null}
      {errors?.map((message) => (
        <FieldError key={message}>{message}</FieldError>
      ))}
    </Field>
  );
}

/**
 * Footer action row for a step, anchored to the bottom of the content column.
 * An optional low-emphasis skip sits on the left; the primary submit (the ink
 * CTA the auth surface uses — Signal Blue is reserved for the active step) on
 * the right.
 */
export function WizardActions({
  onSkip,
  skipLabel = "Skip for now",
  submitLabel,
  pendingLabel,
  pending,
  disabled,
}: {
  onSkip?: () => void;
  skipLabel?: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-6">
      {onSkip ? (
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onSkip}
          disabled={pending}
          className="-ml-2.5 text-muted-foreground"
        >
          {skipLabel}
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" size="lg" disabled={disabled || pending} className="min-w-32">
        {pending ? (
          <>
            <Spinner />
            {pendingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}
