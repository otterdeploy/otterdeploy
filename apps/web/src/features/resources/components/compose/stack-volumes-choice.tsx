/**
 * The "also delete its data volumes" row inside a stack's delete dialog.
 *
 * One component for both delete entry points (the panel's danger zone and
 * the graph's context menu): two ways to delete a stack must not disagree
 * about what a delete takes with it. Default ON, because a deleted stack's
 * volumes are otherwise adopted by the next stack created under the same
 * name, old database password and all. Keeping data is the deliberate
 * choice, so it is the one that takes a click.
 */

import { useTranslation } from "react-i18next";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";

/** Distinct named volumes across a stack's services; 0 when there are none
 *  (or the stack has no parsed services yet), which hides the choice. */
export function stackVolumeCount(
  services: ReadonlyArray<{ volumes: ReadonlyArray<string> }> | undefined,
): number {
  return new Set((services ?? []).flatMap((s) => s.volumes)).size;
}

export function StackVolumesChoice({
  id,
  count,
  checked,
  onCheckedChange,
}: {
  id: string;
  count: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {t("resources.deleteStackVolumes", { count })}
        </Label>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {t("resources.deleteStackVolumesHint")}
        </p>
      </div>
    </div>
  );
}
