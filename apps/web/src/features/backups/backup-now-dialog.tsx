/**
 * Run a backup now. The execution engine backs up database resources, so the
 * source picker lists the org's databases (real `terminal.targets` data) rather
 * than free-text names. Submits via `runBackup` → `backups.run`.
 */
import { useForm } from "@tanstack/react-form";
import { useLiveQuery } from "@tanstack/react-db";
import { FlashIcon, SquareLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Switch } from "@/shared/components/ui/switch";

import { terminalDatabasesCollection } from "@/features/terminal/data/targets";

import type { Destination } from "./data/destinations";
import { runBackup } from "./data/backups";
import { SelectField } from "./form-fields";
import { destUri } from "./shared";

export function BackupNowDialog({
  open,
  onOpenChange,
  destinations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <BackupNowBody onClose={() => onOpenChange(false)} destinations={destinations} />
    </Dialog>
  );
}

function BackupNowBody({
  onClose,
  destinations,
}: {
  onClose: () => void;
  destinations: Destination[];
}) {
  const { data: databases } = useLiveQuery((q) =>
    q.from({ d: terminalDatabasesCollection }),
  );

  const form = useForm({
    defaultValues: { resourceId: "", destinationId: "", encrypted: true },
    onSubmit: async ({ value }) => {
      try {
        await runBackup({
          resourceId: value.resourceId as never,
          destinationId: value.destinationId as never,
          encryption: value.encrypted ? "aes-256-gcm" : "none",
        });
        toast.success("Backup started");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't start backup");
      }
    },
  });

  const dbItems = databases.map((d) => ({
    label: `${d.name} · ${d.projectName}`,
    value: d.resourceId,
  }));
  const destItems = destinations.map((d) => ({
    label: `${d.name} — ${destUri(d)}`,
    value: d.id,
  }));

  return (
    <DialogContent className="max-w-2xl gap-0 p-0">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Run a backup now</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Dump a database to a destination. Runs out-of-band from any schedule.
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
          <form.Field name="resourceId">
            {(field) => (
              <SelectField
                label="Database"
                placeholder={dbItems.length ? "Select a database" : "No databases found"}
                items={dbItems}
                value={field.state.value}
                onChange={field.handleChange}
                mono
              />
            )}
          </form.Field>

          <form.Field name="destinationId">
            {(field) => (
              <SelectField
                label="Destination"
                placeholder={destItems.length ? "Select a destination" : "Add a destination first"}
                items={destItems}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          <form.Field name="encrypted">
            {(field) => (
              <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
                <HugeiconsIcon
                  icon={SquareLock01Icon}
                  className="size-3.5 text-muted-foreground"
                />
                <div className="flex flex-1 flex-col">
                  <span className="text-xs font-medium">Encrypt at rest</span>
                  <span className="text-[11px] text-muted-foreground">
                    AES-256 GCM · key derived from the deployment secret
                  </span>
                </div>
                <Switch checked={field.state.value} onCheckedChange={field.handleChange} />
              </div>
            )}
          </form.Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe
            selector={(s) =>
              [s.isSubmitting, s.values.resourceId, s.values.destinationId] as const
            }
          >
            {([isSubmitting, resourceId, destinationId]) => (
              <Button
                size="sm"
                type="submit"
                className="gap-1.5"
                disabled={isSubmitting || !resourceId || !destinationId}
              >
                <HugeiconsIcon icon={FlashIcon} className="size-3" />
                {isSubmitting ? "Starting…" : "Start backup"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </DialogContent>
  );
}
