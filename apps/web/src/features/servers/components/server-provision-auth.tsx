import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { SshKey } from "@/features/ssh-keys/data/ssh-keys";

import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

import type { ProvisionFormApi } from "./server-provision-form";

import { PickerGroup } from "./provision-picker";

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
                  // A dead end otherwise: this branch renders no FieldError slot, so
                  // the sshKeyId validation failure on submit had nowhere to show.
                  // Offer the path that works from right here.
                  <div className="flex flex-col items-start gap-2">
                    {/* The one-time-password alternative is NOT mentioned here:
                        the button directly below is that alternative, and the
                        tab above is too. Saying it a third time in prose is why
                        this block read as noise. */}
                    <p className="text-sm text-muted-foreground">
                      No SSH keys yet. Create one under Settings → SSH keys, then install its public
                      key on the host.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => authField.handleChange("password")}
                    >
                      Use a one-time password
                    </Button>
                  </div>
                ) : (
                  <Field>
                    <FieldLabel>SSH key</FieldLabel>
                    {/* A Select showed nothing when the value was "" — no
                        placeholder, no cue that a pick was required — so the
                        form submitted with no credential and the run died
                        before it ever opened a connection. */}
                    <PickerGroup
                      label="SSH key"
                      columns="auto"
                      value={field.state.value}
                      onChange={(v) => field.handleChange(v)}
                      options={usableKeys.map((k) => ({
                        value: k.id,
                        label: k.name,
                        hint: "Managed key",
                        icon: <HugeiconsIcon icon={Key01Icon} strokeWidth={2} />,
                      }))}
                    />
                    {field.state.value === "" ? (
                      <p className="text-[12px] text-muted-foreground">
                        Pick the key to connect with. Its public half must already be in the host's
                        authorized_keys.
                      </p>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        Install this key&apos;s public half on the host first (authorized_keys).
                      </p>
                    )}
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
                    Used once to connect, then discarded. Never stored.
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
