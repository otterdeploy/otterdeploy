/**
 * Create-an-API-key dialog. Collects a name, an expiry preset, and an optional
 * set of permission scopes. On success it hands the plaintext token up to the
 * page, which opens the one-time RevealKeyDialog (this dialog never shows it).
 */

import { useForm } from "@tanstack/react-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { apiKeysCollection } from "./data/api-keys";
import { ScopePicker } from "./scope-picker";
import { DEFAULT_EXPIRY_INDEX, EXPIRY_OPTIONS } from "./shared";

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
  const form = useForm({
    defaultValues: {
      name: "",
      expiryIndex: DEFAULT_EXPIRY_INDEX,
      scopes: {} as Record<string, string[]>,
    },
    onSubmit: async ({ value }) => {
      const expiresIn = EXPIRY_OPTIONS[value.expiryIndex]?.seconds ?? null;
      const hasScopes = Object.keys(value.scopes).length > 0;

      // Optimistic insert: `onInsert` mints the key server-side and hands the
      // one-time plaintext token back via `onKey`. Close instantly; surface the
      // result async — TanStack DB rolls the row back on reject.
      const tx = apiKeysCollection.insert(
        {
          id: crypto.randomUUID(),
          organizationId,
          name: value.name.trim(),
          start: null,
          prefix: null,
          enabled: true,
          expiresAt:
            expiresIn == null ? null : new Date(Date.now() + expiresIn * 1000),
          lastRequest: null,
          createdAt: new Date(),
          permissions: hasScopes ? value.scopes : null,
        },
        { metadata: { onKey: onCreated } },
      );

      setOpen(false);
      tx.isPersisted.promise
        .then(() => toast.success("API key created"))
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to create API key",
          ),
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
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Keys belong to this workspace and authenticate automated access
            (CLI, CI, scripts).
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
              onChange: ({ value }) =>
                value.trim().length === 0 ? "Name is required" : undefined,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="CI deploy bot"
                  autoFocus
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="expiryIndex">
            {(field) => (
              <ExpiryField
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          <form.Field name="scopes">
            {(field) => (
              <ScopePicker
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          <DialogFooter className="mt-1">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
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

/** Expiry preset dropdown, keyed by index into EXPIRY_OPTIONS. */
function ExpiryField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // Base UI's <SelectValue> renders the label only when the root is given the
  // full items list; we key options by their index in EXPIRY_OPTIONS.
  const items = EXPIRY_OPTIONS.map((opt, i) => ({
    label: opt.label,
    value: String(i),
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="key-expiry">Expiry</Label>
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
