import type { SshKey } from "@/features/ssh-keys/data/ssh-keys";

import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { ProvisionFormApi } from "./server-provision-form";

export type AuthMode = "key" | "password";

/** SSH credential picker: a managed key (connect with its private half) or a
 *  one-time password (used for this run only, never stored). */
export function ProvisionAuthSection({
  form,
  usableKeys,
}: {
  form: ProvisionFormApi;
  usableKeys: SshKey[];
}) {
  return (
    <form.Field name="authMode">
      {(authField) => (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AuthTab
              active={authField.state.value === "key"}
              onClick={() => authField.handleChange("key")}
            >
              Managed key
            </AuthTab>
            <AuthTab
              active={authField.state.value === "password"}
              onClick={() => authField.handleChange("password")}
            >
              One-time password
            </AuthTab>
          </div>

          {authField.state.value === "key" ? (
            <form.Field
              name="sshKeyId"
              validators={{
                onChange: ({ value }) =>
                  authField.state.value === "key" && value.length === 0
                    ? "Select a key"
                    : undefined,
              }}
            >
              {(field) =>
                usableKeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No generated SSH keys yet — create one under Settings → SSH keys, install its
                    public key on the host, then come back.
                  </p>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="srv-key">SSH key</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v ?? "")}
                      items={usableKeys.map((k) => ({ label: k.name, value: k.id }))}
                    >
                      <SelectTrigger id="srv-key" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {usableKeys.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[12px] text-muted-foreground">
                      Install this key's public half on the host first (authorized_keys).
                    </p>
                  </Field>
                )
              }
            </form.Field>
          ) : (
            <form.Field
              name="password"
              validators={{
                onChange: ({ value }) =>
                  authField.state.value === "password" && value.length === 0
                    ? "Password is required"
                    : undefined,
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="srv-pw">Password</FieldLabel>
                  <Input
                    id="srv-pw"
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Used once to connect, then discarded — never stored.
                  </p>
                  {field.state.meta.errors.map((err) => (
                    <FieldError key={String(err)}>{String(err)}</FieldError>
                  ))}
                </Field>
              )}
            </form.Field>
          )}
        </section>
      )}
    </form.Field>
  );
}

function AuthTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground"
          : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}
