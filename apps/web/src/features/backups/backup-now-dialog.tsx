/**
 * Run a backup now. The engine backs up database resources (logical dump) and
 * named Docker volumes (helper-container tar), so the source picker offers
 * both: databases from `backups.sources` (managed AND compose-stack), volumes
 * from the live daemon inventory (orphans included). Submits via `runBackup` → `backups.run`.
 */
import { useForm, useSelector } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Result } from "better-result";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { orpc } from "@/shared/server/orpc";

import type { Destination } from "./data/destinations";

import {
  EncryptToggle,
  NoDestinations,
  SourceKindField,
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
  initialResourceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
  /** Close this dialog and jump to the destination editor. */
  onAddDestination?: () => void;
  /** Pre-select this database, for when the dialog is opened FROM a database
   *  rather than from the global backups list. */
  initialResourceId?: string;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <BackupNowBody
        onClose={() => onOpenChange(false)}
        destinations={destinations}
        onAddDestination={onAddDestination}
        initialResourceId={initialResourceId}
      />
    </Dialog>
  );
}

/** A blank run, optionally pre-scoped to the database it was opened from. */
function emptyRun(resourceId: string | undefined): {
  sourceKind: "database" | "volume";
  resourceId: string;
  volumeName: string;
  destinationIds: string[];
  encrypted: boolean;
  physical: boolean;
} {
  return {
    sourceKind: "database",
    resourceId: resourceId ?? "",
    volumeName: "",
    destinationIds: [],
    encrypted: true,
    physical: false,
  };
}

type BackupRunValues = ReturnType<typeof emptyRun>;

async function submitBackup(value: BackupRunValues, onClose: () => void): Promise<void> {
  const result = await Result.tryPromise({
    try: () =>
      runBackup({
        ...(value.sourceKind === "volume"
          ? { volumeName: value.volumeName }
          : { resourceId: value.resourceId }),
        destinationIds: value.destinationIds,
        encryption: value.encrypted ? "aes-256-gcm" : "none",
        approach: value.sourceKind === "database" && value.physical ? "physical" : "logical",
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("Couldn't start backup", { cause }),
  });
  if (result.isErr()) {
    toast.error(result.error.message);
    return;
  }
  toast.success(
    value.destinationIds.length > 1
      ? `Backup started → ${value.destinationIds.length} destinations`
      : "Backup started",
  );
  onClose();
}

function BackupNowHeader() {
  return (
    <DialogHeader className="border-b px-5 py-3">
      <DialogTitle className="text-sm font-semibold">Run a backup now</DialogTitle>
      <p className="text-xs text-muted-foreground">
        Dump a database or archive a volume to one or more destinations. Runs out-of-band from any
        schedule.
      </p>
    </DialogHeader>
  );
}

function BackupNowBody({
  onClose,
  destinations,
  onAddDestination,
  initialResourceId,
}: {
  onClose: () => void;
  destinations: Destination[];
  onAddDestination?: () => void;
  initialResourceId?: string;
}) {
  // `backups.sources`, not `terminal.targets`: the latter is the terminal
  // feature's inventory and lists managed `database_resource` rows only, so an
  // install whose databases all live inside compose stacks — the common case —
  // saw "No databases found" while holding live data.
  const { data: databases = [] } = useQuery(orpc.backups.sources.queryOptions({ input: {} }));
  const form = useForm({
    defaultValues: emptyRun(initialResourceId),
    onSubmit: ({ value }) => submitBackup(value, onClose),
  });
  // Only hit the daemon inventory once the Volume source is selected.
  const sourceKind = useSelector(form.store, (s) => s.values.sourceKind);
  const volumeList = useVolumesList(sourceKind === "volume");
  const destOptions = toDestOptions(destinations);

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <BackupNowHeader />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        noValidate
      >
        <div className="flex flex-col gap-4 p-5">
          {/* Omitted, not disabled, when `volumes.list` is out of reach. See
              useVolumesList. The form stays on its "database" default. */}
          {volumeList.available ? (
            <form.Field name="sourceKind">
              {(field) => (
                <SourceKindField value={field.state.value} onChange={field.handleChange} />
              )}
            </form.Field>
          ) : null}

          {sourceKind === "database" ? (
            <>
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
              {/* Physical (pg_basebackup) is a postgres-only capability: a
                  whole-cluster tar for disaster recovery. Offered only when
                  the chosen database is actually postgres, so the option can
                  never fail on engine grounds. */}
              <form.Subscribe selector={(s) => s.values.resourceId}>
                {(resourceId) =>
                  databases.find((d) => d.resourceId === resourceId)?.engine === "postgres" ? (
                    <form.Field name="physical">
                      {(field) => (
                        <Field label="Method">
                          <Segmented
                            value={field.state.value ? "physical" : "logical"}
                            onChange={(v) => field.handleChange(v === "physical")}
                            options={[
                              { id: "logical", label: "Logical dump" },
                              { id: "physical", label: "Physical (pg_basebackup)" },
                            ]}
                          />
                          {field.state.value && (
                            <p className="text-[11px] text-muted-foreground">
                              Whole-cluster tar for disaster recovery. Restores by extracting into a
                              fresh data directory (download only, no in-place restore).
                            </p>
                          )}
                        </Field>
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>
            </>
          ) : (
            <form.Field name="volumeName">
              {(field) => (
                <Field label="Volume">
                  <VolumeCombobox
                    volumes={volumeList.volumes}
                    loading={volumeList.isLoading}
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
