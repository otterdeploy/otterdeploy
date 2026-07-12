/**
 * Presentational pieces of the "Run a backup now" dialog: the destination
 * option mapping, the encrypt-at-rest switch row, the submit button and the
 * no-destinations empty state. Form state stays in `BackupNowBody`.
 */
import {
  CloudServerIcon,
  FlashIcon,
  PlusSignIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";

import type { Destination } from "./data/destinations";

import { destUri } from "./shared";

/** Combobox options for the destination multi-select. */
export function toDestOptions(destinations: Destination[]) {
  return destinations.map((d) => ({
    value: d.id,
    label: d.name,
    tag: d.type,
    keywords: destUri(d),
  }));
}

/** The encrypt-at-rest switch row. */
export function EncryptToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
      <HugeiconsIcon icon={SquareLock01Icon} className="size-3.5 text-muted-foreground" />
      <div className="flex flex-1 flex-col">
        <span className="text-xs font-medium">Encrypt at rest</span>
        <span className="text-[11px] text-muted-foreground">
          AES-256 GCM · key derived from the deployment secret
        </span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Submit button — disabled until a source and at least one destination are picked. */
export function StartBackupButton({
  isSubmitting,
  hasSource,
  destCount,
}: {
  isSubmitting: boolean;
  hasSource: boolean;
  destCount: number;
}) {
  return (
    <Button
      size="sm"
      type="submit"
      className="gap-1.5"
      disabled={isSubmitting || !hasSource || destCount === 0}
    >
      <HugeiconsIcon icon={FlashIcon} className="size-3" />
      {isSubmitting ? "Starting…" : "Start backup"}
    </Button>
  );
}

/** Empty state shown when no backup destinations exist yet. */
export function NoDestinations({
  onClose,
  onAddDestination,
}: {
  onClose: () => void;
  onAddDestination?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Destinations</span>
      <div className="flex items-center gap-3 rounded-md border border-dashed bg-muted/20 px-3 py-2.5">
        <HugeiconsIcon icon={CloudServerIcon} className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col">
          <span className="text-xs font-medium">No destinations yet</span>
          <span className="text-[11px] text-muted-foreground">
            Backups need somewhere to land — local disk, an S3 bucket, or SFTP.
          </span>
        </div>
        {onAddDestination ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="shrink-0 gap-1.5"
            onClick={() => {
              onClose();
              onAddDestination();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3" />
            Add
          </Button>
        ) : null}
      </div>
    </div>
  );
}
