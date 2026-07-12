/**
 * Create a named docker volume. Drivers come from the daemon's plugin list —
 * no invented tiers. The `local` driver has no size quota and no encryption
 * at rest, so those controls don't exist here; the footer says so instead of
 * rendering decorative toggles.
 */
import { type ReactNode } from "react";

import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ORPCError } from "@orpc/client";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import { createVolume } from "./data/volumes";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

interface LabelRow {
  key: string;
  value: string;
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function CreateVolumeDialog({
  open,
  onOpenChange,
  drivers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drivers: string[];
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CreateVolumeBody drivers={drivers} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function CreateVolumeBody({ drivers, onClose }: { drivers: string[]; onClose: () => void }) {
  const form = useForm({
    defaultValues: {
      name: "",
      driver: drivers.includes("local") ? "local" : (drivers[0] ?? "local"),
      labels: [] as LabelRow[],
    },
    onSubmit: async ({ value }) => {
      if (!NAME_RE.test(value.name)) return;
      const labelRecord: Record<string, string> = {};
      for (const row of value.labels) {
        if (row.key.trim()) labelRecord[row.key.trim()] = row.value;
      }
      try {
        await createVolume({
          name: value.name,
          driver: value.driver,
          labels: Object.keys(labelRecord).length > 0 ? labelRecord : undefined,
        });
        toast.success(`Volume ${value.name} created`);
        onClose();
      } catch (err) {
        if (err instanceof ORPCError && err.code === "CONFLICT") {
          toast.error(`A volume named ${value.name} already exists`);
        } else {
          toast.error(err instanceof Error ? err.message : "Couldn't create the volume");
        }
      }
    },
  });

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-lg">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Create volume</DialogTitle>
        <p className="text-xs text-muted-foreground">
          A named volume on this daemon. Attach it to a service via its mounts.
        </p>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        noValidate
      >
        <div className="flex flex-col gap-4 p-5">
          <form.Field name="name">
            {(field) => {
              const nameTouchedInvalid =
                field.state.value.length > 0 && !NAME_RE.test(field.state.value);
              return (
                <Field label="Name">
                  <Input
                    className="font-mono"
                    placeholder="app-uploads"
                    value={field.state.value}
                    autoFocus
                    aria-invalid={nameTouchedInvalid || undefined}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {nameTouchedInvalid ? (
                    <span className="text-xs text-destructive">
                      Must start with a letter or digit; only letters, digits, `_`, `.`, `-`.
                    </span>
                  ) : null}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="driver">
            {(field) => (
              <Field label="Driver">
                <Select
                  items={drivers.map((d) => ({ label: d, value: d }))}
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v ?? field.state.value)}
                >
                  <SelectTrigger className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d} value={d} className="py-1.5 pl-2 font-mono">
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="labels">
            {(field) => <LabelsEditor value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <form.Subscribe selector={(s) => s.values.driver}>
            {(driver) => (
              <span className="max-w-[55%] text-[11px] text-muted-foreground">
                {driver === "local"
                  ? "The local driver has no size quota or encryption — capacity is bounded by the host filesystem."
                  : "Driver options beyond labels aren't configurable here yet."}
              </span>
            )}
          </form.Subscribe>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(s) => ({
                nameValid: NAME_RE.test(s.values.name),
                submitting: s.isSubmitting,
              })}
            >
              {({ nameValid, submitting }) => (
                <Button size="sm" type="submit" disabled={!nameValid || submitting}>
                  {submitting ? "Creating…" : "Create volume"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

/** Editable key/value label rows, submitted as-is (blank keys are dropped). */
function LabelsEditor({
  value,
  onChange,
}: {
  value: LabelRow[];
  onChange: (rows: LabelRow[]) => void;
}) {
  const setLabel = (i: number, patch: Partial<LabelRow>) =>
    onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Labels</span>
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="h-8 flex-1 font-mono text-xs"
            placeholder="key"
            aria-label={`Label ${i + 1} key`}
            value={row.key}
            onChange={(e) => setLabel(i, { key: e.target.value })}
          />
          <Input
            className="h-8 flex-1 font-mono text-xs"
            placeholder="value"
            aria-label={`Label ${i + 1} value`}
            value={row.value}
            onChange={(e) => setLabel(i, { value: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove label ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() => onChange([...value, { key: "", value: "" }])}
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3" />
        Add label
      </Button>
    </div>
  );
}
