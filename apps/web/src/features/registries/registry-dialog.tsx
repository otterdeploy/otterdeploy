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
import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { orpc } from "@/shared/server/orpc";

import { registryCollection } from "./data/registries";
import { RegistryFormBody, useRegistryForm, type RegistryFormValues } from "./registry-form-body";
import { REGISTRY_KIND_META, kindForHost, type RegistryKind } from "./registry-kinds";
import { type RegistryRow } from "./shared";

interface RegistryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: RegistryRow | null;
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
