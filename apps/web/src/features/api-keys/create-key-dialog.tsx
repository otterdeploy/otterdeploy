/**
 * Create-an-API-key dialog. Collects a name, an expiry preset, and what the key
 * may do: an explicit choice between "Limited" (the default; at least one
 * permission must be ticked) and "Full access". Nothing ticked is never full
 * access: Create stays disabled until the choice is complete. On success it
 * hands the plaintext token up to the page, which opens the one-time
 * RevealKeyDialog (this dialog never shows it).
 */

import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import { apiKeysCollection } from "./data/api-keys";
import { ScopePicker } from "./scope-picker";
import { DEFAULT_EXPIRY_INDEX, EXPIRY_OPTIONS, isKeyAccess, type KeyAccess } from "./shared";

export function CreateKeyDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the plaintext token once the key is created. */
  onCreated: (apiKey: string) => void;
}) {
  const { t } = useTranslation();
  // Annotated so the form infers the full field types (`access` the whole
  // union, `scopes` the full record) rather than the literals below. Limited
  // by default: the safest state is the starting state.
  const defaultValues: {
    name: string;
    expiryIndex: number;
    access: KeyAccess;
    scopes: Record<string, string[]>;
  } = {
    name: "",
    expiryIndex: DEFAULT_EXPIRY_INDEX,
    access: "limited",
    scopes: {},
  };
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const expiresIn = EXPIRY_OPTIONS[value.expiryIndex]?.seconds ?? null;
      // Unreachable through the UI (Create is disabled), but never let an
      // empty limited key fall through to anything.
      if (value.access === "limited" && Object.keys(value.scopes).length === 0) return;

      // Optimistic insert: `onInsert` mints the key server-side and hands the
      // one-time plaintext token back via `onKey`. Close instantly; surface the
      // result async: TanStack DB rolls the row back on reject.
      const createdAt = new Date();
      const tx = apiKeysCollection.insert(
        {
          id: crypto.randomUUID(),
          organizationId,
          name: value.name.trim(),
          start: null,
          prefix: null,
          enabled: true,
          expiresAt: expiresIn == null ? null : new Date(createdAt.getTime() + expiresIn * 1000),
          lastRequest: null,
          createdAt,
          // null = full access, the plugin's own representation; onInsert
          // turns it into the explicit `"full"` the server requires.
          permissions: value.access === "full" ? null : value.scopes,
          preset: {},
        },
        { metadata: { onKey: onCreated } },
      );

      setOpen(false);
      tx.isPersisted.promise
        .then(() => toast.success(t("apiKeys.created")))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to create API key"),
        );
    },
  });

  // Clear the form on close so the next open starts fresh.
  const setOpen = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("apiKeys.createTitle")}</DialogTitle>
          <DialogDescription>
            Keys belong to this workspace and authenticate automated access (CLI, CI, scripts).
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (value.trim().length === 0 ? "Name is required" : undefined),
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>{t("common.name")}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("apiKeys.namePlaceholder")}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="expiryIndex">
            {(field) => <ExpiryField value={field.state.value} onChange={field.handleChange} />}
          </form.Field>

          <form.Field name="access">
            {(accessField) => (
              <div className="flex flex-col gap-2">
                <AccessField value={accessField.state.value} onChange={accessField.handleChange} />
                {accessField.state.value === "limited" ? (
                  <form.Field name="scopes">
                    {(field) => (
                      <>
                        <ScopePicker value={field.state.value} onChange={field.handleChange} />
                        {Object.keys(field.state.value).length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {t("apiKeys.choosePermission")}
                          </p>
                        ) : null}
                      </>
                    )}
                  </form.Field>
                ) : null}
              </div>
            )}
          </form.Field>

          <DialogFooter className="mt-1">
            <Button size="sm" variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(s) =>
                s.canSubmit &&
                (s.values.access === "full" || Object.keys(s.values.scopes).length > 0)
              }
            >
              {(canSubmit) => (
                <Button size="sm" type="submit" disabled={!canSubmit}>
                  Create key
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The explicit "what may this key do" choice. Limited is the default and
 *  listed first; full access says plainly what it grants. */
function AccessField({
  value,
  onChange,
}: {
  value: KeyAccess;
  onChange: (next: KeyAccess) => void;
}) {
  const { t } = useTranslation();
  const options: { value: KeyAccess; label: string; hint: string }[] = [
    { value: "limited", label: t("apiKeys.accessLimited"), hint: t("apiKeys.accessLimitedHint") },
    { value: "full", label: t("apiKeys.fullAccess"), hint: t("apiKeys.accessFullHint") },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Label id="key-access-label">{t("apiKeys.access")}</Label>
      <RadioGroup
        aria-labelledby="key-access-label"
        value={value}
        onValueChange={(next) => {
          if (isKeyAccess(next)) onChange(next);
        }}
        className="grid-cols-2 gap-2"
      >
        {options.map((option) => (
          <Label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border p-3 font-normal transition-colors",
              value === option.value && "bg-muted/50",
            )}
          >
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">{option.label}</span>
              <span className="text-[11px] text-muted-foreground">{option.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Expiry preset dropdown, keyed by index into EXPIRY_OPTIONS. */
function ExpiryField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  // Base UI's <SelectValue> renders the label only when the root is given the
  // full items list; we key options by their index in EXPIRY_OPTIONS.
  const items = EXPIRY_OPTIONS.map((opt, i) => ({
    label: opt.label,
    value: String(i),
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="key-expiry">{t("apiKeys.expiry")}</Label>
      <Select
        items={items}
        value={String(value)}
        onValueChange={(v) => onChange(Number(v ?? value))}
      >
        <SelectTrigger id="key-expiry" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
