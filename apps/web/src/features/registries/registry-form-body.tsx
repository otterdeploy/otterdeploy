/**
 * Field set + footer for {@link RegistryDialog} — split into a sibling module
 * to keep the dialog file within the size budget. The form instance is created
 * by the dialog (via {@link useRegistryForm}) and passed down.
 */

import { useForm } from "@tanstack/react-form";

import { Button } from "@/shared/components/ui/button";
import { DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { RegistryRow } from "./shared";

import { FieldShell, HostField, KindPicker } from "./registry-fields";
import { REGISTRY_KIND_META, type RegistryKind } from "./registry-kinds";

export interface RegistryFormValues {
  displayName: string;
  host: string;
  username: string;
  password: string;
}

/** The dialog's form instance — extracted so the field-set component can be
 * typed without re-spelling TanStack Form's generic surface. */
export type RegistryForm = ReturnType<typeof useRegistryForm>;

export function useRegistryForm(args: {
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

export function RegistryFormBody({
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
