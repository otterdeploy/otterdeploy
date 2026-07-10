/**
 * CLI access — surfaces the existing Connect-CLI flow (device-authorization
 * grant; dialog imported from the shell). Personal access tokens are
 * deliberately absent: this install's api-key plugin is configured with
 * `references: "organization"` (packages/auth/src/index.ts), so every key is
 * workspace-owned — the card links to the workspace API keys page instead of
 * pretending user-scoped tokens exist.
 */

import { useState } from "react";

import { CommandLineIcon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";

import { ConnectCliDialog } from "@/features/shell/components/nav/connect-cli-dialog";
import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";

export function CliCard({ orgSlug }: { orgSlug: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <SettingsSection
      icon={CommandLineIcon}
      title="CLI access"
      description="Machine access for the otterdeploy CLI and automation."
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">Connect the CLI</span>
          <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
            Sign the <span className="font-mono">otterdeploy</span> CLI in to this control plane
            with a one-time device code — no token to copy around.
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          Connect CLI
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">API keys</span>
          <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
            Keys on this install are workspace-scoped, not personal — create and manage them on the
            workspace's API keys page.
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0"
          render={<Link to="/$orgSlug/settings/workspace/api-keys" params={{ orgSlug }} />}
        >
          Open API keys
        </Button>
      </div>
      <ConnectCliDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </SettingsSection>
  );
}
