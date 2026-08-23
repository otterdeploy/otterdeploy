/**
 * Public IP card: the addresses behind every sslip.io fallback domain and the
 * Cloudflare A/AAAA records auto-configure writes. Detected on first boot in
 * production; this card makes them visible and correctable (NAT, multi-homed,
 * wrong echo answer). When env SERVER_IP / SERVER_IPV6 pins a value, editing
 * that field is disabled: the env value re-applies on every boot and would
 * silently win.
 *
 * Both addresses render masked. An IP is not a secret, but it is the one
 * string on this page that identifies the operator's machine to anyone
 * glancing at a shared screen or a pasted screenshot — so the calm default is
 * hidden, with one toggle that reveals both.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { GlobalIcon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

function EnvOverrideChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border/60 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-muted-foreground">
      {label}
    </span>
  );
}

/** One labelled address input. Masked unless `revealed`; `pinned` marks the
 *  value as owned by an env var, which is also why it arrives disabled. */
function AddressField(props: {
  inputId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  revealed: boolean;
  pinned: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={props.inputId} className="text-[12px] text-muted-foreground">
          {props.label}
        </label>
        {props.pinned && <EnvOverrideChip label={t("instanceNetwork.envOverride")} />}
      </div>
      <Input
        id={props.inputId}
        type={props.revealed ? "text" : "password"}
        autoComplete="off"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className="font-mono text-[13px]"
      />
    </div>
  );
}

export function ServerIpCard({ organizationId }: { organizationId: OrganizationId }) {
  const { t } = useTranslation();
  const query = useQuery(orpc.organization.getServerIp.queryOptions({ input: { organizationId } }));
  const [revealed, setRevealed] = useState(false);
  const save = useMutation({
    ...orpc.organization.setServerIp.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getServerIp.queryKey({ input: { organizationId } }),
      });
      toast.success(t("instanceNetwork.saved"));
    },
    onError: (err) => toast.error(err.message ?? t("instanceNetwork.saveFailed")),
  });

  const current = query.data?.serverIp ?? "";
  const currentIpv6 = query.data?.serverIpv6 ?? "";
  const envOverride = query.data?.envOverride ?? false;
  const envOverrideIpv6 = query.data?.envOverrideIpv6 ?? false;
  const pinnedBy = [envOverride && "SERVER_IP", envOverrideIpv6 && "SERVER_IPV6"].filter(
    (v) => typeof v === "string",
  );

  // Server-seeded defaults: hydrate the fields until the user touches them.
  const form = useForm({
    defaultValues: { serverIp: current, serverIpv6: currentIpv6 },
    onSubmit: ({ value }) =>
      save.mutate({
        organizationId,
        serverIp: value.serverIp.trim(),
        serverIpv6: value.serverIpv6.trim(),
      }),
  });

  return (
    <SettingsSection
      icon={GlobalIcon}
      title={t("instanceNetwork.title")}
      description={
        <>
          {t("instanceNetwork.descriptionBefore")}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            &lt;name&gt;.&lt;ip&gt;.sslip.io
          </code>
          {t("instanceNetwork.descriptionAfter")}
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">{t("instanceNetwork.addresses")}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            aria-label={
              revealed ? t("instanceNetwork.hideLabel") : t("instanceNetwork.revealLabel")
            }
            onClick={() => setRevealed((v) => !v)}
          >
            <HugeiconsIcon
              icon={revealed ? ViewOffIcon : ViewIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            {revealed ? t("instanceNetwork.hide") : t("instanceNetwork.reveal")}
          </Button>
        </div>

        <form.Field name="serverIp">
          {(field) => (
            <AddressField
              inputId="server-ipv4"
              label={t("instanceNetwork.ipv4")}
              placeholder="203.0.113.10"
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              revealed={revealed}
              pinned={envOverride}
              disabled={envOverride || save.isPending || query.isLoading}
            />
          )}
        </form.Field>

        <form.Field name="serverIpv6">
          {(field) => (
            <AddressField
              inputId="server-ipv6"
              label={t("instanceNetwork.ipv6")}
              placeholder={t("instanceNetwork.ipv6Placeholder")}
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              revealed={revealed}
              pinned={envOverrideIpv6}
              disabled={envOverrideIpv6 || save.isPending || query.isLoading}
            />
          )}
        </form.Field>

        <div className="flex items-center justify-end">
          <form.Subscribe
            selector={(s) =>
              s.values.serverIp.trim() !== current || s.values.serverIpv6.trim() !== currentIpv6
            }
          >
            {(dirty) => (
              <Button
                type="button"
                size="sm"
                disabled={(envOverride && envOverrideIpv6) || !dirty || save.isPending}
                onClick={() => void form.handleSubmit()}
              >
                {save.isPending ? t("common.saving") : t("common.save")}
              </Button>
            )}
          </form.Subscribe>
        </div>

        {pinnedBy.length > 0 && (
          <div className="text-[11.5px] text-muted-foreground">
            {t("instanceNetwork.pinnedBy", { vars: pinnedBy.join(" + ") })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
