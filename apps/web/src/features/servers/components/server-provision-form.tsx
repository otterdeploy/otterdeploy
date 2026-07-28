import type { ServerId, SshKeyId } from "@otterdeploy/shared/id";
import { useTranslation } from "react-i18next";

import { useLiveQuery } from "@tanstack/react-db";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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

import { serverCollection } from "../data/server";
import { managerPromotionWarning } from "../quorum";
import { ProvisionAdvancedSection } from "./server-provision-advanced";
import { type AuthMode, ProvisionAuthSection } from "./server-provision-auth";
import { ProvisionFooter } from "./server-provision-footer";

/**
 * Non-secret fields carried over when re-adding a failed server.
 *
 * One-time passwords and mesh auth keys are deliberately never stored, so a
 * failed run using either can't be retried in place — this lets the operator
 * re-add it without retyping everything except the secret itself.
 */
export interface ProvisionInitialValues {
  name?: string;
  host?: string;
  sshUser?: string;
  sshPort?: string;
  role?: "worker" | "manager";
  buildServer?: boolean;
  meshProvider?: "none" | "tailscale" | "netbird";
}

function useProvisionForm(onStarted: (id: ServerId) => void, initial?: ProvisionInitialValues) {
  return useForm({
    defaultValues: {
      name: initial?.name ?? "",
      host: initial?.host ?? "",
      sshUser: initial?.sshUser ?? "root",
      sshPort: initial?.sshPort ?? "22",
      role: (initial?.role ?? "worker") as "worker" | "manager",
      authMode: "key" as AuthMode,
      sshKeyId: "",
      password: "",
      buildServer: initial?.buildServer ?? false,
      meshProvider: (initial?.meshProvider ?? "none") as "none" | "tailscale" | "netbird",
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
  initial,
}: {
  onStarted: (id: ServerId) => void;
  onCancel: () => void;
  initial?: ProvisionInitialValues;
}) {
  // Only generated keys carry the private half we authenticate with; imported
  // (public-only) keys can't be used to connect out.
  const { data: keys } = useQuery(orpc.sshKeys.list.queryOptions());
  const usableKeys = (keys ?? []).filter((k) => !k.imported);
  const form = useProvisionForm(onStarted, initial);

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
          Otterdeploy connects over SSH, installs Docker, and joins the host to the swarm. You run
          no commands on the box.
        </p>
        <IdentityFields form={form} />
        <ConnectionFields form={form} />
        <div className="border-t" />
        <ProvisionAuthSection form={form} usableKeys={usableKeys} />
        <div className="border-t" />
        <ProvisionAdvancedSection form={form} />
      </div>

      <ProvisionFooter form={form} usableKeys={usableKeys} onCancel={onCancel} />
    </form>
  );
}

/**
 * Promoting a second machine to manager is the intuitive move and the wrong
 * one — see ../quorum. Warn at the point of choosing, with the count this
 * install actually has.
 */
function ManagerQuorumWarning() {
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const managers = servers.filter((s) => s.role === "manager").length;
  const warning = managerPromotionWarning(managers);
  if (!warning) return null;
  return (
    <p className="text-[12px] leading-relaxed text-amber-600 dark:text-amber-500">{warning}</p>
  );
}

function IdentityFields({ form }: { form: ProvisionFormApi }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => (value.trim().length === 0 ? "Name is required" : undefined),
        }}
      >
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>{t("common.name")}</FieldLabel>
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
            <FieldLabel htmlFor={field.name}>{t("servers.form.host")}</FieldLabel>
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
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:grid-cols-3">
      <form.Field name="sshUser">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>{t("servers.form.sshUser")}</FieldLabel>
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
            <FieldLabel htmlFor={field.name}>{t("common.port")}</FieldLabel>
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
            <FieldLabel htmlFor="srv-role">{t("servers.form.role")}</FieldLabel>
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
            {field.state.value === "manager" ? <ManagerQuorumWarning /> : null}
          </Field>
        )}
      </form.Field>
    </div>
  );
}
