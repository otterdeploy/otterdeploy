import { Mail01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ProviderFields } from "./settings-email-fields";
import {
  EMAIL_FORM_SHAPE,
  emailConfigured,
  type EmailSettings,
  useAppForm,
  withForm,
} from "./settings-email-form";

export type { EmailSettings } from "./settings-email-form";

/**
 * Outbound email transport (platform-wide). System emails — verification,
 * org invites, guest OTP — use this; falls back to the env Resend key when
 * left on "Platform default". Secrets are write-only: blank means "leave
 * unchanged", and the configured state shows as a hint, never the value.
 */
export function EmailCard({ organizationId }: { organizationId: never }) {
  const settingsQuery = useQuery(
    orpc.organization.getEmailSettings.queryOptions({
      input: { organizationId },
    }),
  );

  return (
    <SettingsSection
      icon={Mail01Icon}
      title="Email"
      description={
        <>
          Transport for system emails (verification, invites, guest access). Platform-wide for this
          install. Leave on <span className="font-medium">Platform default</span> to use the
          server's configured Resend key, or set your own Resend key / SMTP server here. Keys are
          encrypted at rest.
        </>
      }
    >
      <div className="p-4">
        {settingsQuery.data ? (
          <EmailForm organizationId={organizationId} settings={settingsQuery.data} />
        ) : (
          <div className="text-[12.5px] text-muted-foreground">Loading…</div>
        )}
      </div>
    </SettingsSection>
  );
}

function EmailForm({
  organizationId,
  settings,
}: {
  organizationId: never;
  settings: EmailSettings;
}) {
  const save = useMutation({
    ...orpc.organization.setEmailSettings.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getEmailSettings.queryKey({
          input: { organizationId },
        }),
      });
      toast.success("Email settings saved");
    },
    onError: (err) =>
      toast.error(err.message ?? "Failed to save email settings"),
  });

  const test = useMutation({
    ...orpc.organization.testEmail.mutationOptions(),
    onSuccess: (res) =>
      res.ok
        ? toast.success("Test email sent")
        : toast.error(res.error ?? "Test email failed"),
    onError: (err) => toast.error(err.message ?? "Test email failed"),
  });

  const form = useAppForm({
    defaultValues: {
      provider: (settings.provider ?? "") as "" | "resend" | "smtp",
      from: settings.from ?? "",
      resendApiKey: "",
      smtpHost: settings.smtpHost ?? "",
      smtpPort: settings.smtpPort != null ? String(settings.smtpPort) : "587",
      smtpSecure: settings.smtpSecure ?? false,
      smtpUser: settings.smtpUser ?? "",
      smtpPassword: "",
      testTo: "",
    },
    onSubmit: ({ value }) => {
      save.mutate({
        organizationId,
        provider: value.provider === "" ? null : value.provider,
        from: value.from.trim() || null,
        // Write-only: only send a secret when the operator typed a new one.
        resendApiKey: value.resendApiKey ? value.resendApiKey : undefined,
        smtpHost: value.smtpHost.trim() || null,
        smtpPort: value.smtpPort.trim() ? Number(value.smtpPort) : null,
        smtpSecure: value.smtpSecure,
        smtpUser: value.smtpUser.trim() || null,
        smtpPassword: value.smtpPassword ? value.smtpPassword : undefined,
      });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      {!emailConfigured(settings) && (
        <div className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] text-warning">
          <span className="font-medium">Email isn't configured</span>
          <span className="text-warning/85">
            Invites, verification, and guest-access codes won't send until you
            set a provider below (Resend or SMTP) or set{" "}
            <code className="font-mono">RESEND_API_KEY</code>.
          </span>
        </div>
      )}

      <ProviderFields form={form} settings={settings} />

      <EmailFormFooter
        form={form}
        saving={save.isPending}
        testing={test.isPending}
        onTest={(to) => test.mutate({ organizationId, to })}
      />
    </form>
  );
}

const EmailFormFooter = withForm({
  defaultValues: EMAIL_FORM_SHAPE,
  props: {
    saving: false,
    testing: false,
    onTest: (_to: string) => {},
  },
  render: ({ form, saving, testing, onTest }) => (
    <div className="flex items-center justify-end gap-2 border-t pt-3">
      <form.Field name="testTo">
        {(field) => (
          <Input
            type="email"
            placeholder="you@example.com"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            className="max-w-[220px] text-[13px]"
          />
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.testTo}>
        {(testTo) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!testTo || testing}
            onClick={() => onTest(testTo)}
          >
            {testing ? "Sending…" : "Send test"}
          </Button>
        )}
      </form.Subscribe>
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  ),
});
