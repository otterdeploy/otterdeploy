/**
 * The SSH tab's form: where the server is, who to sign in as, and with which
 * key. otterdeploy then connects and does the whole install itself.
 *
 * The key is a Select of the keys otterdeploy holds the private half of, with
 * a one-time password as the last option, so a server that does not trust any
 * key yet is still reachable from here. Control plane is opt-in and off by
 * default; most servers just run workloads.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

import { serverCollection } from "../data/server";
import { managerPromotionWarning } from "../quorum";
import { PanelBody, PanelFooter } from "./panel";
import { CredentialRows } from "./ssh-credential";
import {
  BLANK,
  parsePort,
  SSH_FORM_ID,
  type SshFormApi,
  type SshInitialValues,
  useSshForm,
} from "./use-ssh-form";

export type { SshInitialValues };

function AddressRow({ form }: { form: SshFormApi }) {
  return (
    <div className="flex items-start gap-2">
      <form.Field
        name="host"
        validators={{
          onSubmit: ({ value }) =>
            value.trim().length === 0 ? "Enter the server's address." : undefined,
        }}
      >
        {(field) => (
          <Field
            className="min-w-0 flex-1"
            data-invalid={field.state.meta.errors.length > 0 || undefined}
          >
            <FieldLabel htmlFor="add-server-host">Address</FieldLabel>
            <Input
              id="add-server-host"
              className="font-mono"
              placeholder="203.0.113.24"
              autoComplete="off"
              spellCheck={false}
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0 || undefined}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.map((err) => (
              <FieldError key={String(err)}>{String(err)}</FieldError>
            ))}
          </Field>
        )}
      </form.Field>
      <form.Field
        name="sshPort"
        validators={{
          onSubmit: ({ value }) => (parsePort(value) === null ? "1 to 65535." : undefined),
        }}
      >
        {(field) => (
          <Field
            className="w-22 shrink-0"
            data-invalid={field.state.meta.errors.length > 0 || undefined}
          >
            <FieldLabel htmlFor="add-server-port">Port</FieldLabel>
            <Input
              id="add-server-port"
              className="font-mono"
              inputMode="numeric"
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0 || undefined}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors.map((err) => (
              <FieldError key={String(err)}>{String(err)}</FieldError>
            ))}
          </Field>
        )}
      </form.Field>
    </div>
  );
}

function ControlPlaneField({ form }: { form: SshFormApi }) {
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const managers = servers.filter((s) => s.role === "manager").length;
  return (
    <form.Field name="controlPlane">
      {(field) => {
        const warning = field.state.value ? managerPromotionWarning(managers) : null;
        return (
          <Field orientation="horizontal">
            <Checkbox
              id="add-server-control-plane"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
            <FieldContent>
              <FieldLabel htmlFor="add-server-control-plane">Control plane</FieldLabel>
              {warning ? (
                <FieldDescription className="text-warning">{warning}</FieldDescription>
              ) : (
                <FieldDescription>
                  Only for an extra control plane. Most servers just run workloads.
                </FieldDescription>
              )}
            </FieldContent>
          </Field>
        );
      }}
    </form.Field>
  );
}

export function SshForm({
  initial,
  onStarted,
  onCancel,
}: {
  initial: SshInitialValues | undefined;
  onStarted: (id: ServerId) => void;
  onCancel: () => void;
}) {
  // Only generated keys carry the private half otterdeploy signs in with.
  const { data: keys } = useQuery(orpc.sshKeys.list.queryOptions());
  const usableKeys = (keys ?? []).filter((k) => !k.imported);
  const { form, submitError } = useSshForm(initial ?? BLANK, usableKeys, onStarted);

  return (
    <>
      <PanelBody>
        <form
          id={SSH_FORM_ID}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <AddressRow form={form} />
          <CredentialRows form={form} usableKeys={usableKeys} />
          <ControlPlaneField form={form} />
          {submitError ? <FieldError>{submitError}</FieldError> : null}
        </form>
      </PanelBody>
      <PanelFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" form={SSH_FORM_ID} disabled={submitting}>
              {submitting ? "Starting…" : "Connect and install"}
            </Button>
          )}
        </form.Subscribe>
      </PanelFooter>
    </>
  );
}
