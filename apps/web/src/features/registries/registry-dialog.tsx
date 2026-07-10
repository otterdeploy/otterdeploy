/**
 * Add / edit dialog for a container registry credential.
 *
 * Same component for both flows — when `existing` is set we PATCH and
 * the password field is optional (blank = leave existing in place); when
 * it's null we POST and password is required. The host field is locked
 * after creation because changing it would semantically be "this is now
 * a different registry" — operators should delete and re-add.
 *
 * The kind picker is UX sugar: picking a kind pre-fills the host and
 * adapts field hints, but only host/username/password are stored. The
 * selected kind is re-derived from the host (`kindForHost`) whenever the
 * typed host maps to a known registry, so tiles and text stay in sync.
 */

import { useState } from "react";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
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
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { registryCollection } from "./data/registries";
import { FieldShell, HostField, KindPicker } from "./registry-fields";
import { REGISTRY_KIND_META, kindForHost, type RegistryKind } from "./registry-kinds";
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

export function RegistryDialog({ open, onOpenChange, existing }: RegistryDialogProps) {
  const isEdit = existing !== null;

  // Sticky kind from an explicit tile pick — needed because picking e.g.
  // ECR clears the host (account-specific), and `kindForHost("")` would
  // immediately snap the selection back to Generic.
  const [pickedKind, setPickedKind] = useState<RegistryKind | null>(null);

  const testConnection = useMutation(orpc.registry.testConnection.mutationOptions());

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
          toast.success(isEdit ? "Registry credential updated" : "Registry credential added"),
        )
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to save registry"),
        );
    },
  });

  const host = useStore(form.store, (s) => s.values.host);
  const kind = pickedKind ?? kindForHost(existing?.host ?? host);

  const pickKind = (k: RegistryKind) => {
    setPickedKind(k);
    form.setFieldValue("host", REGISTRY_KIND_META[k].hostPrefill);
    testConnection.reset();
  };

  const onHostChange = (next: string) => {
    // Follow the typed host when it maps to a known registry; otherwise
    // keep the explicit tile pick (its hints are still what the user wants).
    if (kindForHost(next) !== "generic") setPickedKind(null);
    testConnection.reset();
  };

  const runTest = (values: RegistryFormValues) => {
    // Edit flow: host is locked and a blank password means "use stored" —
    // test by id so the server decrypts the saved secret. A typed password
    // rides along as an override so it can be verified before saving.
    const input = existing
      ? {
          id: existing.id,
          username: values.username.trim(),
          ...(values.password.length > 0 && { password: values.password }),
        }
      : {
          host: values.host.trim(),
          username: values.username.trim(),
          password: values.password,
        };
    testConnection.mutate(input);
  };

  // Clear the form on close so the next open starts fresh.
  const setOpen = (next: boolean) => {
    if (!next) {
      form.reset();
      setPickedKind(null);
      testConnection.reset();
    }
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
          <RegistryFormBody
            form={form}
            isEdit={isEdit}
            kind={kind}
            onPickKind={pickKind}
            onHostChange={onHostChange}
            onTest={runTest}
            testPending={testConnection.isPending}
            testResult={testConnection.data ?? null}
            onCancel={() => setOpen(false)}
          />
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
  kind,
  onPickKind,
  onHostChange,
  onTest,
  testPending,
  testResult,
  onCancel,
}: {
  form: RegistryForm;
  isEdit: boolean;
  kind: RegistryKind;
  onPickKind: (k: RegistryKind) => void;
  onHostChange: (host: string) => void;
  onTest: (values: RegistryFormValues) => void;
  testPending: boolean;
  testResult: { ok: boolean; message: string } | null;
  onCancel: () => void;
}) {
  const meta = REGISTRY_KIND_META[kind];

  return (
    <>
      {!isEdit && <KindPicker value={kind} onPick={onPickKind} />}

      <form.Field name="displayName">
        {(field) => (
          <FieldShell label="Display name" htmlFor="reg-display">
            <Input
              id="reg-display"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={
                kind === "generic" ? "Internal registry (ci-bot)" : `${meta.label} (ci-bot)`
              }
              autoFocus
            />
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="host">
        {(field) => (
          <HostField
            value={field.state.value}
            onChange={(v) => {
              field.handleChange(v);
              onHostChange(v);
            }}
            isEdit={isEdit}
            kind={kind}
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
              placeholder={meta.usernamePlaceholder}
              autoComplete="off"
            />
            {meta.usernameHint && (
              <p className="text-[11px] text-muted-foreground">{meta.usernameHint}</p>
            )}
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
            <p className="text-[11px] text-muted-foreground">{meta.passwordHint}</p>
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted (AES-GCM, key derived from the auth secret).
            </p>
          </FieldShell>
        )}
      </form.Field>

      {testResult && (
        <p
          role="status"
          className={cn("text-[11.5px]", testResult.ok ? "text-success" : "text-destructive")}
        >
          {testResult.message}
        </p>
      )}

      <DialogFooter className="mt-2 sm:justify-between">
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
            // Testing needs a reachable target: create mode wants the full
            // inline triple; edit mode can always fall back to stored creds.
            const canTest = isEdit || (v.host.trim().length > 0 && v.password.length > 0);
            return (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={!canTest || testPending}
                  onClick={() => onTest(v)}
                >
                  {testPending ? "Testing…" : "Test connection"}
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" type="button" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" disabled={!canSubmit}>
                    {isEdit ? "Save changes" : "Add registry"}
                  </Button>
                </div>
              </>
            );
          }}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
}
