/**
 * The SSH tab's sign-in rows: User beside the key Select, then one hint naming
 * the key the server must trust (or the password used once instead).
 */

import { useState } from "react";

import { Link, useParams } from "@tanstack/react-router";

import type { SshKey } from "@/features/ssh-keys/data/ssh-keys";

import { truncateFingerprint } from "@/features/ssh-keys/data/ssh-keys";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { copyToClipboard } from "@/shared/lib/clipboard";

import { PASSWORD, type SshFormApi } from "./use-ssh-form";

/** "The server must trust deploy-key (SHA256:…). Copy its public key". */
function KeyHint({ sshKey }: { sshKey: SshKey }) {
  const [copied, setCopied] = useState(false);
  return (
    <FieldDescription>
      The server must trust <span className="font-mono text-foreground">{sshKey.name}</span> (
      <span className="font-mono">{truncateFingerprint(sshKey.fingerprint)}</span>).{" "}
      <button
        type="button"
        className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        onClick={() => {
          void copyToClipboard(sshKey.publicKey).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy its public key"}
      </button>
    </FieldDescription>
  );
}

function NoKeyHint() {
  const { orgSlug } = useParams({ strict: false });
  return (
    <FieldDescription>
      No SSH key yet.{" "}
      {orgSlug ? (
        <Link to="/$orgSlug/workspace/ssh-keys" params={{ orgSlug }}>
          Generate one
        </Link>
      ) : (
        "Generate one under SSH keys"
      )}
      , or sign in with the server&apos;s password this once.
    </FieldDescription>
  );
}

export function CredentialRows({ form, usableKeys }: { form: SshFormApi; usableKeys: SshKey[] }) {
  return (
    <form.Field name="credential">
      {(field) => {
        const choice = field.state.value || usableKeys[0]?.id || PASSWORD;
        const sshKey = usableKeys.find((k) => k.id === choice);
        const items = [
          ...usableKeys.map((k) => ({ label: k.name, value: k.id })),
          { label: "Password, used once", value: PASSWORD },
        ];
        return (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <form.Field name="sshUser">
                {(user) => (
                  <Field className="w-40 shrink-0">
                    <FieldLabel htmlFor="add-server-user">User</FieldLabel>
                    <Input
                      id="add-server-user"
                      className="font-mono"
                      autoComplete="off"
                      spellCheck={false}
                      value={user.state.value}
                      onChange={(e) => user.handleChange(e.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="add-server-key">SSH key</FieldLabel>
                <Select
                  value={choice}
                  items={items}
                  onValueChange={(v) => {
                    if (typeof v === "string") field.handleChange(v);
                  }}
                >
                  <SelectTrigger id="add-server-key" className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usableKeys.map((k) => (
                      <SelectItem key={k.id} value={k.id} className="font-mono">
                        {k.name}
                      </SelectItem>
                    ))}
                    {usableKeys.length > 0 ? <SelectSeparator /> : null}
                    <SelectItem value={PASSWORD}>Password, used once</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {sshKey ? <KeyHint sshKey={sshKey} /> : null}
            {!sshKey && usableKeys.length === 0 ? <NoKeyHint /> : null}
            {sshKey ? null : <PasswordField form={form} usableKeys={usableKeys} />}
          </div>
        );
      }}
    </form.Field>
  );
}

function PasswordField({ form, usableKeys }: { form: SshFormApi; usableKeys: SshKey[] }) {
  return (
    <form.Field
      name="password"
      validators={{
        // Checked against the live choice: switching back to a key leaves this
        // field's validator registered, and it must not block that submit.
        onSubmit: ({ value, fieldApi }) => {
          const choice = fieldApi.form.getFieldValue("credential") || usableKeys[0]?.id;
          const usingPassword = !usableKeys.some((k) => k.id === choice);
          return usingPassword && value.length === 0 ? "Enter the server's password." : undefined;
        },
      }}
    >
      {(field) => (
        <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
          <FieldLabel htmlFor="add-server-password">Server password</FieldLabel>
          <Input
            id="add-server-password"
            type="password"
            autoComplete="off"
            value={field.state.value}
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          {field.state.meta.errors.length > 0 ? (
            field.state.meta.errors.map((err) => (
              <FieldError key={String(err)}>{String(err)}</FieldError>
            ))
          ) : (
            <FieldDescription>Used once to connect, then discarded. Never stored.</FieldDescription>
          )}
        </Field>
      )}
    </form.Field>
  );
}
