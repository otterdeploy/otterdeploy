/**
 * Add / edit dialog for a container registry credential.
 *
 * Same component for both flows — when `existing` is set we PATCH and
 * the password field is optional (blank = leave existing in place); when
 * it's null we POST and password is required. The host field is locked
 * after creation because changing it would semantically be "this is now
 * a different registry" — operators should delete and re-add.
 */

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import { registryCollection } from "./data/registries";
import { FieldShell, HostField } from "./registry-fields";
import { type RegistryRow } from "./shared";

interface RegistryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: RegistryRow | null;
}

interface RegistryFormValues {
  displayName: string;
  host: string;
  username: string;
  password: string;
}

/** The dialog's form instance — extracted so the field-set component can be
 * typed without re-spelling TanStack Form's generic surface. */
type RegistryForm = ReturnType<typeof useRegistryForm>;

function useRegistryForm(args: {
  existing: RegistryRow | null;
  onSubmit: (value: RegistryFormValues) => void;
}) {
  return useForm({
    // Re-hydrate per render so opening an edit / create row starts from the
    // right values — TanStack Form keeps the live state once mounted; `reset`
    // on close clears it for the next open.
    defaultValues: {
      displayName: args.existing?.displayName ?? "",
      host: args.existing?.host ?? "",
      username: args.existing?.username ?? "",
      password: "",
    },
    onSubmit: ({ value }) => args.onSubmit(value),
  });
}

export function RegistryDialog({
  open,
  onOpenChange,
  existing,
}: RegistryDialogProps) {
  const isEdit = existing !== null;

  const form = useRegistryForm({
    existing,
    onSubmit: (value) => {
      // Optimistic mutate: close instantly, surface the outcome off the
      // transaction's persisted promise — TanStack DB rolls back on reject.
      const tx = existing
        ? registryCollection.update(
            existing.id,
            { metadata: { password: value.password } },
            (draft) => {
              draft.displayName = value.displayName.trim();
              draft.username = value.username.trim();
            },
          )
        : registryCollection.insert(
            {
              id: createId(ID_PREFIX.containerRegistry),
              displayName: value.displayName.trim(),
              host: value.host.trim(),
              username: value.username.trim(),
              authType: "password",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { metadata: { password: value.password } },
          );

      setOpen(false);
      tx.isPersisted.promise
        .then(() =>
          toast.success(
            isEdit ? "Registry credential updated" : "Registry credential added",
          ),
        )
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to save registry",
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit registry credential" : "Add registry credential"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <RegistryFormBody form={form} isEdit={isEdit} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Field set + footer for the registry dialog — split out to keep the
 * dialog component under the per-function line budget. */
function RegistryFormBody({
  form,
  isEdit,
  onCancel,
}: {
  form: RegistryForm;
  isEdit: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <form.Field name="displayName">
        {(field) => (
          <FieldShell label="Display name" htmlFor="reg-display">
            <Input
              id="reg-display"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="GHCR (ci-bot)"
              autoFocus
            />
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="host">
        {(field) => (
          <HostField
            value={field.state.value}
            onChange={field.handleChange}
            isEdit={isEdit}
          />
        )}
      </form.Field>

      <form.Field name="username">
        {(field) => (
          <FieldShell label="Username" htmlFor="reg-username">
            <Input
              id="reg-username"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="ci-bot"
              autoComplete="off"
            />
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <FieldShell
            label={isEdit ? "New password / token (optional)" : "Password / token"}
            htmlFor="reg-password"
          >
            <Input
              id="reg-password"
              type="password"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={isEdit ? "Leave blank to keep current" : ""}
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted (AES-GCM, key derived from the auth secret).
            </p>
          </FieldShell>
        )}
      </form.Field>

      <DialogFooter className="mt-2">
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe
          selector={(s) => ({
            displayName: s.values.displayName,
            host: s.values.host,
            username: s.values.username,
            password: s.values.password,
          })}
        >
          {(v) => {
            const canSubmit =
              v.displayName.trim().length > 0 &&
              v.host.trim().length > 0 &&
              v.username.trim().length > 0 &&
              (isEdit || v.password.length > 0);
            return (
              <Button size="sm" type="submit" disabled={!canSubmit}>
                {isEdit ? "Save changes" : "Add registry"}
              </Button>
            );
          }}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
}
