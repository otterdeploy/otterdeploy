/**
 * Add / edit dialog for an external secret provider.
 *
 * Same component for both flows — when `editing` is set we PATCH and the
 * credential field is optional (blank = keep the stored one); when it's null
 * we POST and the credential is required. The kind is locked after creation:
 * changing it would semantically be "this is now a different provider", so
 * operators delete and re-add instead.
 *
 * The credential is write-only from here on — the list endpoint only ever
 * returns `credentialSet: boolean`.
 */

import { omitUndefined } from "@otterdeploy/shared/object";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/shared/components/ui/native-select";

import type { ProviderFormValues } from "./provider-fields";

import {
  KIND_LABELS,
  useCreateVaultProvider,
  useUpdateVaultProvider,
  type VaultProvider,
  type VaultProviderKind,
} from "./data/vault-providers";
import { CREDENTIAL_LABELS, KIND_FIELDS, ProviderTextField } from "./provider-fields";

/** Mirrors the contract's name regex — the token grammar's provider slug. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const KINDS: VaultProviderKind[] = ["hashicorp", "infisical", "doppler"];

const EMPTY_FORM: ProviderFormValues = {
  kind: "hashicorp",
  name: "",
  credential: "",
  url: "",
  mount: "secret",
  namespace: "",
  siteUrl: "",
  clientId: "",
  projectId: "",
  environmentSlug: "",
  secretPath: "",
  dopplerProject: "",
  dopplerConfig: "",
};

function defaultsFor(editing: VaultProvider | null): ProviderFormValues {
  if (!editing) return { ...EMPTY_FORM };
  // The config bag's keys line up with the flat form field names by design;
  // omitUndefined keeps blanks at their EMPTY_FORM defaults.
  return {
    ...EMPTY_FORM,
    ...omitUndefined(editing.config),
    kind: editing.kind,
    name: editing.name,
  };
}

/** Per-kind required fields beyond `name` (+ credential when creating). */
function formSchema(isEdit: boolean) {
  return z
    .object({
      kind: z.enum(["hashicorp", "infisical", "doppler"]),
      name: z
        .string()
        .min(1, "Required")
        .regex(NAME_PATTERN, "Lowercase letters, digits, `-` and `_` only"),
      credential: isEdit ? z.string() : z.string().min(1, "Required"),
      url: z.string(),
      mount: z.string(),
      namespace: z.string(),
      siteUrl: z.string(),
      clientId: z.string(),
      projectId: z.string(),
      environmentSlug: z.string(),
      secretPath: z.string(),
      dopplerProject: z.string(),
      dopplerConfig: z.string(),
    })
    .superRefine((v, ctx) => {
      const require = (path: keyof ProviderFormValues, ok: boolean) => {
        if (!ok) ctx.addIssue({ code: "custom", path: [path], message: "Required" });
      };
      if (v.kind === "hashicorp") require("url", v.url.trim().length > 0);
      if (v.kind === "infisical") {
        require("clientId", v.clientId.trim().length > 0);
        require("projectId", v.projectId.trim().length > 0);
        require("environmentSlug", v.environmentSlug.trim().length > 0);
      }
    });
}

const opt = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

/** Assemble the discriminated create payload from the flat form values. */
function toCreateInput(v: ProviderFormValues) {
  const name = v.name.trim();
  if (v.kind === "hashicorp") {
    return {
      kind: "hashicorp" as const,
      name,
      config: { url: v.url.trim(), mount: v.mount.trim() || "secret", namespace: opt(v.namespace) },
      credential: v.credential,
    };
  }
  if (v.kind === "infisical") {
    return {
      kind: "infisical" as const,
      name,
      config: {
        siteUrl: opt(v.siteUrl),
        clientId: v.clientId.trim(),
        projectId: v.projectId.trim(),
        environmentSlug: v.environmentSlug.trim(),
        secretPath: opt(v.secretPath),
      },
      credential: v.credential,
    };
  }
  return {
    kind: "doppler" as const,
    name,
    config: { dopplerProject: opt(v.dopplerProject), dopplerConfig: opt(v.dopplerConfig) },
    credential: v.credential,
  };
}

export function ProviderDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: VaultProvider | null;
}) {
  const isEdit = editing !== null;
  const create = useCreateVaultProvider();
  const update = useUpdateVaultProvider();

  const form = useForm({
    defaultValues: defaultsFor(editing),
    validators: { onSubmit: formSchema(isEdit) },
    onSubmit: async ({ value }) => {
      try {
        if (editing) {
          const { name, config } = toCreateInput(value);
          await update.mutateAsync({
            id: editing.id,
            name,
            config,
            ...(value.credential ? { credential: value.credential } : {}),
          });
          toast.success("Provider updated");
        } else {
          await create.mutateAsync(toCreateInput(value));
          toast.success("Provider added — run a connection test to verify it");
        }
        form.reset();
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save provider");
      }
    },
  });

  const kind = useStore(form.store, (s) => s.values.kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit secret provider" : "Add secret provider"}</DialogTitle>
          <DialogDescription>
            Reference its secrets from any env var as{" "}
            <code className="font-mono text-[11px]">{"${{vault.<name>.<ref>}}"}</code>. Values are
            fetched at deploy time and never stored here.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <Field>
            <FieldLabel htmlFor="vault-kind">Provider</FieldLabel>
            <form.Field name="kind">
              {(field) => (
                <NativeSelect
                  id="vault-kind"
                  className="w-full"
                  value={field.state.value}
                  disabled={isEdit}
                  onChange={(e) => {
                    const next = KINDS.find((k) => k === e.target.value);
                    if (next) field.handleChange(next);
                  }}
                >
                  {KINDS.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {KIND_LABELS[k]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </form.Field>
          </Field>

          <form.Field name="name">
            {(field) => (
              <ProviderTextField
                field={field}
                label="Name"
                placeholder="prod-vault"
                hint="The <provider> segment of ${{vault.<provider>.<ref>}} tokens."
              />
            )}
          </form.Field>

          {KIND_FIELDS[kind].map((f) => (
            <form.Field key={`${kind}:${f.name}`} name={f.name}>
              {(field) => (
                <ProviderTextField
                  field={field}
                  label={f.label}
                  placeholder={f.placeholder}
                  hint={f.hint}
                />
              )}
            </form.Field>
          ))}

          <form.Field name="credential">
            {(field) => (
              <ProviderTextField
                field={field}
                label={CREDENTIAL_LABELS[kind]}
                type="password"
                hint={
                  isEdit
                    ? "Leave blank to keep the stored credential."
                    : "Stored encrypted; never shown again."
                }
              />
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state}>
              {(state) => (
                <Button type="submit" disabled={!state.canSubmit || state.isSubmitting}>
                  {state.isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add provider"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
