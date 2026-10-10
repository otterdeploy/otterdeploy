/**
 * The expanded credential form for one social sign-in provider. Split out of
 * ./instance-social-sign-in.tsx so neither that file nor its row component
 * carries the whole provider surface.
 *
 * The callback URL is built from the browser's own origin rather than a
 * configured value: it has to match what the OAuth provider will actually be
 * redirected to, and that's whatever host the operator reached the dashboard
 * on. Showing anything else would hand them a URL that silently fails.
 */

import { SettingsFooter, SettingsRow } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import { SecretRow } from "@/shared/components/secret-row";

export type SocialProviderId = "github" | "google" | "gitlab";

export function ProviderFields({
  id,
  callbackPath,
  clientId,
  onClientId,
  clientSecret,
  onClientSecret,
  secretConfigured,
  envConfigured,
  issuer,
  onIssuer,
  saving,
  onSave,
}: {
  id: SocialProviderId;
  callbackPath: string;
  clientId: string;
  onClientId: (next: string) => void;
  clientSecret: string;
  onClientSecret: (next: string) => void;
  secretConfigured: boolean;
  envConfigured: boolean;
  issuer: string;
  onIssuer: (next: string) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <SettingsRow
        stacked
        title="Callback URL"
        description="Register this exact URL with the OAuth app before enabling the provider."
        control={
          <code className="block truncate rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px] text-muted-foreground">
            {`${window.location.origin}${callbackPath}`}
          </code>
        }
      />
      <SettingsRow
        stacked
        title="Client ID"
        control={
          <Input
            value={clientId}
            onChange={(e) => onClientId(e.target.value)}
            placeholder={envConfigured ? "Set via environment" : ""}
            className="font-mono text-[12.5px]"
            disabled={saving}
          />
        }
      />
      <SecretRow
        stacked
        title="Client secret"
        configured={secretConfigured}
        unsetDescription="Encrypted at rest and never shown again after saving."
        value={clientSecret}
        onChange={onClientSecret}
        disabled={saving}
      />
      {id === "gitlab" && (
        <SettingsRow
          stacked
          title="Instance URL"
          description="Self-hosted GitLab only. Leave blank for gitlab.com."
          control={
            <Input
              value={issuer}
              onChange={(e) => onIssuer(e.target.value)}
              placeholder="https://gitlab.example.com"
              className="font-mono text-[12.5px]"
              disabled={saving}
            />
          }
        />
      )}
      <SettingsFooter>
        <Button size="sm" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </>
  );
}
