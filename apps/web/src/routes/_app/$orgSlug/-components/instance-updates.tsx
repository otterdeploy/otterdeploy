/**
 * Updates card — the Instance-page home for the platform self-updater.
 * Reads the same `useUpdateStatus` model as the shell banner/header pill and
 * opens the same update dialog (owned by the org layout's UpdateProvider),
 * so every surface tells one story. This card is the always-there place to
 * check on demand and see when the last check ran.
 */

import { Rocket01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { useCheckForUpdate, useUpdate, useUpdateStatus } from "@/features/updates";
import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

function lastCheckedLabel(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}

export function UpdatesCard() {
  const status = useUpdateStatus();
  const { openUpdate } = useUpdate();
  const check = useCheckForUpdate();

  const onCheck = () =>
    check.mutate(
      {},
      {
        onSuccess: (result) => {
          if (result.updateAvailable && result.latest) {
            toast.success(`Update available: ${result.latest}`);
          } else {
            toast.success("You're on the latest version.");
          }
        },
        onError: (err) => toast.error(err.message ?? "Update check failed"),
      },
    );

  return (
    <SettingsSection
      icon={Rocket01Icon}
      title="Updates"
      description="Platform self-update — check the release channel and apply new versions of otterdeploy from here."
    >
      <SettingsRow
        title="Current version"
        description={
          status.dryRun
            ? "Dev / dry-run install — applying an update runs as a simulation."
            : "The image tag this install booted with."
        }
        control={
          <span className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">
              {status.current}
            </code>
            {status.dryRun && <Badge variant="secondary">dry-run</Badge>}
          </span>
        }
      />
      <SettingsRow
        title="Latest available"
        description={`Last checked: ${lastCheckedLabel(status.lastCheckedAt)}`}
        control={
          status.available && status.latest ? (
            <Badge className="font-mono">{status.latest}</Badge>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">
              {status.isLoading ? "…" : "Up to date"}
            </span>
          )
        }
      />
      <SettingsFooter>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={check.isPending}
          onClick={onCheck}
        >
          {check.isPending ? "Checking…" : "Check for updates"}
        </Button>
        {status.available && status.latest && (
          <Button type="button" size="sm" onClick={openUpdate}>
            View update
          </Button>
        )}
      </SettingsFooter>
    </SettingsSection>
  );
}
