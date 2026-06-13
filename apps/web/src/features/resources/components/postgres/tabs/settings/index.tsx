/**
 * Settings tab body for a postgres resource — composes the per-section
 * cards (identity, storage, public access, maintenance, danger zone).
 * Each card lives in its own file so this orchestrator stays scannable.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  Key01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";

import type { PostgresBodyProps } from "../../types";
import { SettingsCard, SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";
import { DangerZone } from "./danger-zone";
import { ExtensionsCard } from "./extensions-card";
import { PublicAccessCard } from "./public-access-card";

interface PostgresSettingsBodyProps {
  resource: PostgresBodyProps["resource"];
  onDeleted: () => void;
}

export function PostgresSettingsBody({
  resource,
  onDeleted,
}: PostgresSettingsBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Identity"
        description="Renaming is not yet supported — once it lands the change will rotate the derived service name + hostname."
      >
        <SettingsRowReadOnly label="Name" value={resource.name} />
        <SettingsRowReadOnly label="Engine" value={resource.engine} />
        <SettingsRowReadOnly label="Database name" value={resource.databaseName} />
        <SettingsRowReadOnly label="Username" value={resource.username} />
      </SettingsCard>

      <SettingsCard title="Storage">
        <SettingsRowReadOnly label="Volume" value={resource.runtime.volumeName} />
        <SettingsRowReadOnly label="Network" value={resource.runtime.networkName} />
        <SettingsRowReadOnly
          label="Internal endpoint"
          value={`${resource.internalHostname}:${resource.internalPort}`}
        />
      </SettingsCard>

      <PublicAccessCard resource={resource} />

      {resource.engine === "postgres" && <ExtensionsCard resource={resource} />}

      <SettingsCard
        title="Maintenance"
        description="Rotation + backup procedures aren't wired yet — buttons are intentionally disabled rather than no-op stubs."
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Rotate password</span>
            <span className="text-[11px] text-muted-foreground">
              Generates a new password and rolls connection strings.
            </span>
          </div>
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
            Rotate
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Take backup</span>
            <span className="text-[11px] text-muted-foreground">
              Snapshot the volume to off-cluster storage.
            </span>
          </div>
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Snapshot now
          </Button>
        </div>
      </SettingsCard>

      <DangerZone resource={resource} onDeleted={onDeleted} />
    </div>
  );
}
