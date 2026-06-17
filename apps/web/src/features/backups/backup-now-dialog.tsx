/**
 * Run a backup now. The execution engine backs up database resources, so the
 * source picker lists the org's databases (real `terminal.targets` data) rather
 * than free-text names. Submits via `runBackup` → `backups.run`.
 */
import { useForm } from "@tanstack/react-form";
import { useLiveQuery } from "@tanstack/react-db";
import {
  CloudServerIcon,
  FlashIcon,
  PlusSignIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
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
import { DatabaseCombobox } from "./database-combobox";
import { MultiSelectCombobox } from "./multi-combobox";
import { Field, destUri } from "./shared";

export function BackupNowDialog({
  open,
  onOpenChange,
  destinations,
  onAddDestination,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
  /** Close this dialog and jump to the destination editor. */
  onAddDestination?: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <BackupNowBody
        onClose={() => onOpenChange(false)}
        destinations={destinations}
        onAddDestination={onAddDestination}
      />
    </Dialog>
  );
}

function BackupNowBody({
  onClose,
  destinations,
  onAddDestination,
}: {
  onClose: () => void;
  destinations: Destination[];
  onAddDestination?: () => void;
}) {
  const { data: databases } = useLiveQuery((q) =>
    q.from({ d: terminalDatabasesCollection }),
  );

  const form = useForm({
    defaultValues: {
      resourceId: "",
      destinationIds: [] as string[],
      encrypted: true,
    },
    onSubmit: async ({ value }) => {
      try {
        await runBackup({
          resourceId: value.resourceId as never,
          destinationIds: value.destinationIds as never,
          encryption: value.encrypted ? "aes-256-gcm" : "none",
        });
        toast.success(
          value.destinationIds.length > 1
            ? `Backup started → ${value.destinationIds.length} destinations`
            : "Backup started",
        );
        onClose();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't start backup",
        );
      }
    },
  });

  const destOptions = destinations.map((d) => ({
    value: d.id,
    label: d.name,
    tag: d.type,
    keywords: destUri(d),
  }));

  return (
    <DialogContent className="sm:max-w-3xl gap-0 p-0 ">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          Run a backup now
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Dump a database to one or more destinations. Runs out-of-band from
          any schedule.
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
              <Field label="Database">
                <DatabaseCombobox
                  databases={databases}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>

          {destOptions.length ? (
            <form.Field name="destinationIds">
              {(field) => (
                <Field label="Destinations">
                  <MultiSelectCombobox
                    options={destOptions}
                    value={field.state.value}
                    onChange={field.handleChange}
                    placeholder="Select destinations…"
                    searchPlaceholder="Search destinations…"
                    emptyText="No destinations yet."
                  />
                </Field>
              )}
            </form.Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Destinations</span>
              <div className="flex items-center gap-3 rounded-md border border-dashed bg-muted/20 px-3 py-2.5">
                <HugeiconsIcon
                  icon={CloudServerIcon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <div className="flex flex-1 flex-col">
                  <span className="text-xs font-medium">
                    No destinations yet
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Backups need somewhere to land — local disk, an S3 bucket,
                    or SFTP.
                  </span>
                </div>
                {onAddDestination ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="shrink-0 gap-1.5"
                    onClick={() => {
                      onClose();
                      onAddDestination();
                    }}
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="size-3" />
                    Add
                  </Button>
                ) : null}
              </div>
            </div>
          )}

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
                <Switch
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
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
              [
                s.isSubmitting,
                s.values.resourceId,
                s.values.destinationIds.length,
              ] as const
            }
          >
            {([isSubmitting, resourceId, destCount]) => (
              <Button
                size="sm"
                type="submit"
                className="gap-1.5"
                disabled={isSubmitting || !resourceId || destCount === 0}
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
