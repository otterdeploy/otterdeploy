import type { ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { DialogFooter } from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ProvisionAdvancedSection } from "./server-provision-advanced";
import { type AuthMode, ProvisionAuthSection } from "./server-provision-auth";

function useProvisionForm(onStarted: (id: ServerId) => void) {
  return useForm({
    defaultValues: {
      name: "",
      host: "",
      sshUser: "root",
      sshPort: "22",
      role: "worker" as "worker" | "manager",
      authMode: "key" as AuthMode,
      sshKeyId: "",
      password: "",
      buildServer: false,
      meshProvider: "none" as "none" | "tailscale" | "netbird",
      meshAuthKey: "",
      meshManagementUrl: "",
      cloudflareToken: "",
    },
    onSubmit: async ({ value }) => {
      const usingKey = value.authMode === "key";
      const usingMesh = value.meshProvider !== "none";
      try {
        const row = await orpc.server.provision.call({
          name: value.name.trim(),
          host: value.host.trim(),
          sshUser: value.sshUser.trim() || "root",
          sshPort: Number(value.sshPort) || 22,
          role: value.role,
          sshKeyId: usingKey ? (value.sshKeyId as SshKeyId) : undefined,
          password: usingKey ? undefined : value.password,
          buildServer: value.buildServer,
          meshProvider: value.meshProvider,
          meshAuthKey: usingMesh ? value.meshAuthKey : undefined,
          meshManagementUrl:
            value.meshProvider === "netbird" && value.meshManagementUrl.trim()
              ? value.meshManagementUrl.trim()
              : undefined,
          cloudflareToken: value.cloudflareToken.trim() || undefined,
        });
        // Surface the row in the table immediately (as "provisioning"); the
        // stream-ended invalidate refreshes it to its terminal state.
        void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
        onStarted(row.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start provisioning");
      }
    },
  });
}

/** Concrete form-instance type, shared with the extracted field sections. */
export type ProvisionFormApi = ReturnType<typeof useProvisionForm>;

export function ProvisionForm({
  onStarted,
  onCancel,
}: {
  onStarted: (id: ServerId) => void;
  onCancel: () => void;
}) {
  // Only generated keys carry the private half we authenticate with; imported
  // (public-only) keys can't be used to connect out.
  const { data: keys } = useQuery(orpc.sshKeys.list.queryOptions());
  const usableKeys = (keys ?? []).filter((k) => !k.imported);
  const form = useProvisionForm(onStarted);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Otterdeploy connects over SSH, installs Docker, and joins the host to the swarm — no
          commands to run on the box.
        </p>
        <IdentityFields form={form} />
        <ConnectionFields form={form} />
        <div className="border-t" />
        <ProvisionAuthSection form={form} usableKeys={usableKeys} />
        <div className="border-t" />
        <ProvisionAdvancedSection form={form} />
      </div>

      <DialogFooter className="mt-5 flex-row items-center sm:justify-end">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button size="sm" className="h-8" type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Starting…" : "Provision server"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </DialogFooter>
    </form>
  );
}

function IdentityFields({ form }: { form: ProvisionFormApi }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => (value.trim().length === 0 ? "Name is required" : undefined),
        }}
      >
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Name</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              placeholder="prod-04"
              value={field.state.value}
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
        name="host"
        validators={{
          onChange: ({ value }) =>
            value.trim().length === 0 ? "Host / IP is required" : undefined,
        }}
      >
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Host / IP</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              placeholder="203.0.113.7"
              className="font-mono"
              value={field.state.value}
              onBlur={field.handleBlur}
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

function ConnectionFields({ form }: { form: ProvisionFormApi }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <form.Field name="sshUser">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>SSH user</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              className="font-mono"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="sshPort">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Port</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              inputMode="numeric"
              className="font-mono"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="role">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="srv-role">Role</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                if (v === "worker" || v === "manager") field.handleChange(v);
              }}
              items={[
                { label: "worker", value: "worker" },
                { label: "manager (raft quorum)", value: "manager" },
              ]}
            >
              <SelectTrigger id="srv-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worker">worker</SelectItem>
                <SelectItem value="manager">manager (raft quorum)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>
    </div>
  );
}
