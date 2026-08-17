/**
 * Settings tab body for a postgres resource: composes the per-section
 * cards (identity, storage, public access, maintenance, danger zone).
 * Each card lives in its own file so this orchestrator stays scannable.
 */

import { useState } from "react";

import { ArrowReloadHorizontalIcon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";

import { BackupNowDialog } from "@/features/backups/backup-now-dialog";
import { destinationsCollection } from "@/features/backups/data/destinations";
import {
  SettingsCard,
  SettingsRowReadOnly,
} from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";

import type { PostgresBodyProps } from "../../types";

import { BackupsCard } from "./backups-card";
import { DangerZone } from "./danger-zone";
import { EphemeralAccessCard } from "./ephemeral-access-card";
import { ExtensionsCard } from "./extensions-card";
import { DatabasePlacementCard } from "./placement-card";
import { PublicAccessCard } from "./public-access-card";

interface PostgresSettingsBodyProps {
  resource: PostgresBodyProps["resource"];
  onDeleted: () => void;
  // Pending-create mode: the database isn't provisioned yet, so only the
  // settings that map to the manifest (public access + extensions) are
  // editable. Identity / storage / maintenance / danger need a live resource
  // and are omitted until after the first deploy.
  pending?: boolean;
  dbName?: string;
}

export function PostgresSettingsBody({
  resource,
  onDeleted,
  pending = false,
  dbName,
}: PostgresSettingsBodyProps) {
  const [backupOpen, setBackupOpen] = useState(false);
  const { data: destinations } = useLiveQuery((q) => q.from({ d: destinationsCollection }));

  if (pending) {
    return (
      <div className="flex flex-col gap-6">
        <PublicAccessCard resource={resource} pending dbName={dbName} />
        {resource.engine === "postgres" && (
          <ExtensionsCard resource={resource} pending dbName={dbName} />
        )}
        <p className="text-[11px] text-muted-foreground/70">
          Identity, storage, and maintenance settings unlock once the database is deployed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Identity"
        description="Renaming is not yet supported. Once it lands, the change will rotate the derived service name and hostname."
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

      {/* Above backups on purpose: the safe way to move a database is to back
          it up first, and the placement card's refusal says exactly that. */}
      <DatabasePlacementCard
        resource={{
          projectId: resource.projectId,
          id: resource.resourceId,
          name: resource.name,
          placementServerId: resource.placementServerId,
        }}
      />

      <BackupsCard resourceId={resource.resourceId} />

      {resource.engine === "postgres" && <EphemeralAccessCard resource={resource} />}

      {resource.engine === "postgres" && <ExtensionsCard resource={resource} />}

      <SettingsCard
        title="Maintenance"
        description="Run an on-demand backup, or rotate the database password."
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Rotate password</span>
            {/* Still genuinely unimplemented: there is no rotate endpoint in
                the API. Says so specifically, rather than the old shared blurb
                that also claimed backups weren't wired (they are). */}
            <span className="text-[11px] text-muted-foreground">
              Not available yet. Rotating a password means rolling every connection string that
              embeds it.
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
              Dump this database to one of your storage destinations.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            // `backups.run` has existed the whole time, and the dialog it
            // needs already accepts `initialResourceId` for exactly this
            // entry point: the button was disabled by a description written
            // for the rotate row next to it.
            onClick={() => {
              // Warm the destinations on the click that needs them, not from a
              // mount effect. This page has no other reason to load them.
              void destinationsCollection.preload();
              setBackupOpen(true);
            }}
          >
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} className="size-3.5" />
            Snapshot now
          </Button>
        </div>
      </SettingsCard>

      <BackupNowDialog
        open={backupOpen}
        onOpenChange={setBackupOpen}
        destinations={destinations}
        initialResourceId={resource.resourceId}
      />

      <DangerZone resource={resource} onDeleted={onDeleted} />
    </div>
  );
}
