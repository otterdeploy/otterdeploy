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

import { useForm, useStore } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  KIND_LABELS,
  useCreateVaultProvider,
  useUpdateVaultProvider,
  type VaultProvider,
} from "./data/vault-providers";
import { ProviderMark } from "./kind-logos";
import { CREDENTIAL_LABEL_KEYS, KIND_FIELDS, ProviderTextField } from "./provider-fields";
import { KINDS, defaultsFor, formSchema, toCreateInput } from "./provider-form";

/** The literal reference-token grammar, shown in hints. Passed to `t()` as an
 *  interpolation value because its `${{…}}` shape would otherwise read as an
 *  i18next placeholder inside a translation string. */
const TOKEN_EXAMPLE = "${{vault.<provider>.<ref>}}";

export function ProviderDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: VaultProvider | null;
}) {
  const { t } = useTranslation();
  const isEdit = editing !== null;
  const create = useCreateVaultProvider();
  const update = useUpdateVaultProvider();

  const form = useForm({
    defaultValues: defaultsFor(editing),
    validators: { onSubmit: formSchema(isEdit, t) },
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
          toast.success(t("vault.providerUpdated"));
        } else {
          await create.mutateAsync(toCreateInput(value));
          toast.success(t("vault.providerAdded"));
        }
        form.reset();
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("vault.saveError"));
      }
    },
  });

  const kind = useStore(form.store, (s) => s.values.kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("vault.editTitle") : t("vault.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("vault.dialogDescriptionBefore")}{" "}
            <code className="font-mono text-[11px]">{"${{vault.<name>.<ref>}}"}</code>
            {t("vault.dialogDescriptionAfter")}
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
            <FieldLabel htmlFor="vault-kind">{t("vault.providerLabel")}</FieldLabel>
            <form.Field name="kind">
              {(field) => (
                <Select
                  items={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                  value={field.state.value}
                  disabled={isEdit}
                  onValueChange={(v) => {
                    const next = KINDS.find((k) => k === v);
                    if (next) field.handleChange(next);
                  }}
                >
                  <SelectTrigger id="vault-kind" className="h-9 w-full">
                    <span className="flex items-center gap-2">
                      <ProviderMark
                        kind={field.state.value}
                        className="size-6 rounded"
                        logoClassName="size-3.5"
                      />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        <ProviderMark
                          kind={k}
                          className="size-6 rounded"
                          logoClassName="size-3.5"
                        />
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </form.Field>
          </Field>

          <form.Field name="name">
            {(field) => (
              <ProviderTextField
                field={field}
                label={t("vault.nameLabel")}
                placeholder="prod-vault"
                hint={t("vault.nameHint", { token: TOKEN_EXAMPLE })}
              />
            )}
          </form.Field>

          {KIND_FIELDS[kind].map((f) => (
            <form.Field key={`${kind}:${f.name}`} name={f.name}>
              {(field) => (
                <ProviderTextField
                  field={field}
                  label={t(f.labelKey)}
                  placeholder={f.placeholder}
                  hint={f.hintKey ? t(f.hintKey) : undefined}
                />
              )}
            </form.Field>
          ))}

          <form.Field name="credential">
            {(field) => (
              <ProviderTextField
                field={field}
                label={t(CREDENTIAL_LABEL_KEYS[kind])}
                type="password"
                hint={isEdit ? t("vault.credentialHintEdit") : t("vault.credentialHintCreate")}
              />
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <form.Subscribe selector={(state) => state}>
              {(state) => (
                <Button type="submit" disabled={!state.canSubmit || state.isSubmitting}>
                  {state.isSubmitting
                    ? t("common.saving")
                    : isEdit
                      ? t("vault.saveChanges")
                      : t("vault.addProvider")}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
