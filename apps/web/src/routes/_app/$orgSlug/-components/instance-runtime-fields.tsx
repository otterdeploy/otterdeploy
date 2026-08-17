/**
 * The Runtime card's draft shape, its validator, and the two row primitives it
 * repeats. Split out of instance-runtime.tsx purely for file length: the card
 * body reads as a list of settings and this is the machinery under it.
 */

import type { ReactNode } from "react";

import { runtimeSettingsDraftSchema } from "@otterdeploy/api/routers/organization/runtime-settings-schema";

import { SettingsRow } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";

export interface Draft {
  egressAllowlist: string;
  previewIdleTeardownHours: number;
  edgeLogPersist: boolean;
  edgeLogRetentionDays: number;
  edgeLogGeoipUrl: string;
  edgeLogGeoipAsnUrl: string;
  builderConcurrency: number;
}

/** Placeholder shape for the pre-fetch render only. The server's values
 *  overwrite every field the moment the query resolves. */
export const EMPTY_DRAFT: Draft = {
  egressAllowlist: "",
  previewIdleTeardownHours: 72,
  edgeLogPersist: false,
  edgeLogRetentionDays: 7,
  edgeLogGeoipUrl: "",
  edgeLogGeoipAsnUrl: "",
  builderConcurrency: 1,
};

export type FieldErrors = Partial<Record<keyof Draft, string>>;

/** Real narrowing from a zod issue path segment to a Draft field: the key set
 *  comes from EMPTY_DRAFT, which is a complete Draft, so it can't drift. */
const DRAFT_KEYS: ReadonlySet<string> = new Set(Object.keys(EMPTY_DRAFT));
function isDraftKey(key: PropertyKey): key is keyof Draft {
  return typeof key === "string" && DRAFT_KEYS.has(key);
}

/**
 * Run the SAME schema the server enforces, against the current draft, and key
 * the messages by field.
 *
 * Validating here is not a nicety: a malformed IP is knowable without asking
 * anyone, and the round trip's rejection arrives as a generic "Input
 * validation failed" toast that names neither the field nor the entry. Zod
 * gives us the precise message for free; the only thing that was missing was
 * running it. The server still validates. This makes the client stop being
 * the last to know, it does not move the authority.
 */
export function validate(draft: Draft): FieldErrors {
  const parsed = runtimeSettingsDraftSchema.safeParse(draft);
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const first = issue.path[0];
    const field = isDraftKey(first) ? first : undefined;
    // First issue per field wins: later ones are usually the same problem
    // restated, and a row has room for one line.
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** The inline message under a control. Renders nothing when the field is
 *  clean, so a valid form has no reserved empty space. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-[11.5px] leading-relaxed text-destructive">
      {message}
    </p>
  );
}

/** A bounded integer setting with its unit: the shape four of these rows
 *  share, extracted so the card body stays readable. */
export function NumberRow({
  title,
  description,
  unit,
  badge,
  value,
  min,
  max,
  disabled,
  error,
  onChange,
}: {
  title: string;
  description: ReactNode;
  unit?: string;
  badge?: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  error?: string;
  onChange: (next: number) => void;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <div>
          <div className="flex items-center gap-2.5">
            {badge && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {badge}
              </Badge>
            )}
            <Input
              type="number"
              min={min}
              max={max}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              aria-invalid={error ? true : undefined}
              className="w-24 font-mono text-[12.5px]"
              disabled={disabled}
            />
            {unit && <span className="text-[12px] text-muted-foreground">{unit}</span>}
          </div>
          <FieldError message={error} />
        </div>
      }
    />
  );
}

/** A full-width free-text setting (URLs, the allowlist). */
export function TextRow({
  title,
  description,
  value,
  placeholder,
  disabled,
  error,
  onChange,
}: {
  title: string;
  description?: ReactNode;
  value: string;
  placeholder?: string;
  disabled: boolean;
  error?: string;
  onChange: (next: string) => void;
}) {
  return (
    <SettingsRow
      stacked
      title={title}
      description={description}
      control={
        <div>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            className="font-mono text-[12.5px]"
            disabled={disabled}
          />
          <FieldError message={error} />
        </div>
      }
    />
  );
}
