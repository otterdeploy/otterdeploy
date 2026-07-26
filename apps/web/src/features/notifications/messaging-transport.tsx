/**
 * SMS + push transport — the Twilio and FCM credentials the notification
 * fan-out uses. Every other destination (Slack, Discord, Telegram, PagerDuty,
 * webhooks, email) has always been configured in the UI with its secret
 * encrypted at rest; these two alone required editing `.env` and restarting.
 * This closes that gap — the env vars still work and still seed these fields.
 *
 * Lives on the Notifications page next to the channels it feeds, not on
 * Instance settings: these are delivery credentials, nothing else reads them.
 * Values are still install-wide (the `platform_settings` singleton) and the
 * read/write handlers are install-admin gated.
 *
 * A missing or half-configured transport is never an error: the in-app
 * notification row is written regardless, and the external send is a logged
 * no-op.
 */

import { useState } from "react";

import type { OrganizationId } from "@otterdeploy/shared/id";
import { Message01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SecretRow } from "@/shared/components/secret-row";
import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

type MessagingSettings = Awaited<ReturnType<typeof orpc.organization.getMessagingSettings.call>>;

/**
 * Normalize the server shape (and the in-flight `undefined`) once, so the JSX
 * below reads plain fields instead of scattering optional chaining through the
 * markup.
 */
function normalize(raw: MessagingSettings | undefined) {
  return {
    twilioAccountSid: raw?.twilioAccountSid ?? "",
    twilioFromNumber: raw?.twilioFromNumber ?? "",
    twilioAuthTokenConfigured: raw?.twilioAuthTokenConfigured ?? false,
    fcmServerKeyConfigured: raw?.fcmServerKeyConfigured ?? false,
    twilioEnvConfigured: raw?.twilioEnvConfigured ?? false,
    fcmEnvConfigured: raw?.fcmEnvConfigured ?? false,
  };
}

export function MessagingTransportCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getMessagingSettings.queryOptions({ input: { organizationId } }),
  );

  // Draft-only-when-touched: null means "show the server value", so a
  // background refetch can't clobber something half-typed.
  const [accountSid, setAccountSid] = useState<string | null>(null);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [fcmKey, setFcmKey] = useState("");

  const save = useMutation({
    ...orpc.organization.setMessagingSettings.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getMessagingSettings.queryKey({ input: { organizationId } }),
      });
      setAccountSid(null);
      setFromNumber(null);
      setAuthToken("");
      setFcmKey("");
      toast.success("Messaging transports saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save messaging settings"),
  });

  const data = normalize(query.data);
  const sidValue = accountSid ?? data.twilioAccountSid;
  const fromValue = fromNumber ?? data.twilioFromNumber;
  const busy = save.isPending || query.isLoading;

  const dirty =
    accountSid !== null || fromNumber !== null || authToken.length > 0 || fcmKey.length > 0;

  return (
    <SettingsSection
      icon={Message01Icon}
      title="SMS & push"
      description="Credentials for the SMS and push channels. Optional — every notification is written to the in-app feed regardless."
    >
      <SettingsRow
        title="Twilio account SID"
        description={
          data.twilioEnvConfigured && !data.twilioAccountSid
            ? "Currently supplied by the environment. A value here takes over."
            : "Found on the Twilio console dashboard."
        }
        control={
          <Input
            value={sidValue}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="ACxxxxxxxx"
            className="font-mono text-[12.5px] sm:w-72"
            disabled={busy}
          />
        }
      />
      <SecretRow
        title="Twilio auth token"
        configured={data.twilioAuthTokenConfigured}
        fromEnv={data.twilioEnvConfigured}
        unsetDescription="Encrypted at rest and never shown again after saving."
        value={authToken}
        onChange={setAuthToken}
        disabled={busy}
      />
      <SettingsRow
        title="Twilio sender number"
        description="The E.164 number messages are sent from."
        control={
          <Input
            value={fromValue}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+14155550123"
            className="font-mono text-[12.5px] sm:w-72"
            disabled={busy}
          />
        }
      />
      <SecretRow
        title="FCM server key"
        configured={data.fcmServerKeyConfigured}
        fromEnv={data.fcmEnvConfigured}
        unsetDescription="Firebase Cloud Messaging key for push delivery. Encrypted at rest."
        value={fcmKey}
        onChange={setFcmKey}
        disabled={busy}
      />
      <SettingsFooter>
        {dirty && <span className="text-[11.5px] text-muted-foreground">Unsaved changes</span>}
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              organizationId,
              twilioAccountSid: sidValue.trim() || null,
              twilioFromNumber: fromValue.trim() || null,
              // Omit untouched secrets so saving an unrelated field doesn't
              // wipe a stored credential.
              ...(authToken ? { twilioAuthToken: authToken } : {}),
              ...(fcmKey ? { fcmServerKey: fcmKey } : {}),
            })
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
