import { useLiveQuery } from "@tanstack/react-db";
/**
 * Run a backup now. The engine backs up database resources (logical dump) and
 * named Docker volumes (helper-container tar), so the source picker offers
 * both: databases from real `terminal.targets` data, volumes from the live
 * daemon inventory (orphans included). Submits via `runBackup` → `backups.run`.
 */
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";

import { terminalDatabasesCollection } from "@/features/terminal/data/targets";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

import type { Destination } from "./data/destinations";

import {
  EncryptToggle,
  NoDestinations,
  StartBackupButton,
  toDestOptions,
} from "./backup-now-parts";
import { runBackup } from "./data/backups";
import { useVolumesList } from "./data/volumes";
import { DatabaseCombobox } from "./database-combobox";
import { MultiSelectCombobox } from "./multi-combobox";
import { Field, Segmented } from "./shared";
import { VolumeCombobox } from "./volume-combobox";

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
  const { data: databases } = useLiveQuery((q) => q.from({ d: terminalDatabasesCollection }));

  const form = useForm({
    defaultValues: {
      sourceKind: "database" as "database" | "volume",
      resourceId: "",
      volumeName: "",
      destinationIds: [] as string[],
      encrypted: true,
    },
    onSubmit: async ({ value }) => {
      try {
        await runBackup({
          ...(value.sourceKind === "volume"
            ? { volumeName: value.volumeName }
            : { resourceId: value.resourceId as never }),
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
        toast.error(err instanceof Error ? err.message : "Couldn't start backup");
      }
    },
  });

  // Only hit the daemon inventory once the Volume source is selected.
  const sourceKind = useStore(form.store, (s) => s.values.sourceKind);
  const { volumes, isLoading: volumesLoading } = useVolumesList(sourceKind === "volume");

  const destOptions = toDestOptions(destinations);

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Run a backup now</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Dump a database or archive a volume to one or more destinations. Runs out-of-band from any
          schedule.
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
          <form.Field name="sourceKind">
            {(field) => (
              <Field label="Source">
                <Segmented
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={[
                    { id: "database", label: "Database" },
                    { id: "volume", label: "Volume" },
                  ]}
                />
              </Field>
            )}
          </form.Field>

          {sourceKind === "database" ? (
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
          ) : (
            <form.Field name="volumeName">
              {(field) => (
                <Field label="Volume">
                  <VolumeCombobox
                    volumes={volumes}
                    loading={volumesLoading}
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
          )}

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
            <NoDestinations onClose={onClose} onAddDestination={onAddDestination} />
          )}

          <form.Field name="encrypted">
            {(field) => <EncryptToggle checked={field.state.value} onChange={field.handleChange} />}
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
                s.values.sourceKind === "volume" ? s.values.volumeName : s.values.resourceId,
                s.values.destinationIds.length,
              ] as const
            }
          >
            {([isSubmitting, source, destCount]) => (
              <StartBackupButton
                isSubmitting={Boolean(isSubmitting)}
                hasSource={Boolean(source)}
                destCount={destCount}
              />
            )}
          </form.Subscribe>
        </div>
      </form>
    </DialogContent>
  );
}
