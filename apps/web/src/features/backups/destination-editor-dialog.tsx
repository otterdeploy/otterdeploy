/**
 * Create / edit a backup destination. TanStack Form drives the fields; on
 * submit it mutates `destinationsCollection` optimistically (secret threaded
 * through the mutation metadata, since it never lives on a row). Reset happens
 * by remounting per target (the `key`) — no `useEffect`.
 */
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import type { Destination } from "./data/destinations";
import { destinationsCollection } from "./data/destinations";
import {
  DEST_TYPE_FIELDS,
  DestinationTypeFields,
  configFromInitial,
} from "./destination-fields";
import type { DestinationKind } from "./shared";
import { Field, Segmented } from "./shared";

export function DestinationEditorDialog({
  initial,
  organizationId,
  open,
  onOpenChange,
}: {
  initial: Destination | null;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DestinationEditorBody
        key={initial?.id ?? "new"}
        initial={initial}
        organizationId={organizationId}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

/** Build the optimistic mutation for a create or an edit. */
function saveDestination(
  initial: Destination | null,
  organizationId: string,
  value: {
    name: string;
    type: DestinationKind;
    config: Record<string, string>;
    secret: Record<string, string>;
  },
) {
  const fields = DEST_TYPE_FIELDS[value.type];
  const cleanConfig: Record<string, string> = {};
  for (const f of fields.config) {
    const v = value.config[f.key]?.trim();
    if (v) cleanConfig[f.key] = v;
  }
  const cleanSecret: Record<string, string> = {};
  for (const f of fields.secret) {
    const v = value.secret[f.key]?.trim();
    if (v) cleanSecret[f.key] = v;
  }
  const metadata = { secret: cleanSecret };

  if (initial) {
    return destinationsCollection.update(
      initial.id,
      { metadata },
      (draft) => {
        draft.name = value.name.trim();
        draft.config = cleanConfig;
      },
    );
  }
  return destinationsCollection.insert(
    {
      id: crypto.randomUUID() as Destination["id"],
      organizationId,
      name: value.name.trim(),
      type: value.type,
      config: cleanConfig,
      status: "active",
      usedBytes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { metadata },
  );
}

function DestinationEditorBody({
  initial,
  organizationId,
  onClose,
}: {
  initial: Destination | null;
  organizationId: string;
  onClose: () => void;
}) {
  const editing = initial !== null;

  const form = useForm({
    defaultValues: {
      name: initial?.name ?? "",
      type: (initial?.type ?? "s3") as DestinationKind,
      config: configFromInitial(initial),
      secret: {} as Record<string, string>,
    },
    onSubmit: ({ value }) => {
      const tx = saveDestination(initial, organizationId, value);
      onClose();
      tx.isPersisted.promise
        .then(() =>
          toast.success(editing ? "Destination updated" : "Destination created"),
        )
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Couldn't save destination",
          ),
        );
    },
  });

  return (
    <DialogContent className="sm:max-w-3xl gap-0 p-0">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          {editing ? "Edit destination" : "Add destination"}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Where backups are written. Credentials are encrypted at rest.
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
            {(field) => (
              <Field label="Name">
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="S3 · primary"
                />
              </Field>
            )}
          </form.Field>

          {!editing && (
            <form.Field name="type">
              {(field) => (
                <Field label="Type">
                  <Segmented
                    value={field.state.value}
                    onChange={(t) => {
                      field.handleChange(t);
                      form.setFieldValue("config", {});
                      form.setFieldValue("secret", {});
                    }}
                    options={[
                      { id: "s3", label: "S3" },
                      { id: "local", label: "Local disk" },
                      { id: "sftp", label: "SFTP" },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
          )}

          <form.Subscribe selector={(s) => s.values.type}>
            {(type) => (
              <form.Field name="config">
                {(cfg) => (
                  <form.Field name="secret">
                    {(sec) => (
                      <DestinationTypeFields
                        type={type}
                        config={cfg.state.value}
                        onConfig={cfg.handleChange}
                        secret={sec.state.value}
                        onSecret={sec.handleChange}
                        editing={editing}
                      />
                    )}
                  </form.Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => [s.canSubmit, s.values.name] as const}>
            {([canSubmit, name]) => (
              <Button size="sm" type="submit" disabled={!canSubmit || !name.trim()}>
                {editing ? "Save changes" : "Create destination"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </DialogContent>
  );
}
