/**
 * One event-definition row: name, inline display-name edit (saves on blur),
 * the conversion switch, in-window counts, last seen, and archive/restore.
 * Owns its mutations so a slow save on one row never disables another.
 */

import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { AnalyticsScope } from "../../hooks/use-web-analytics";

import { formatCount } from "../../analytics-model";
import { isoMs } from "../../lib/iso-ms";

const stamp = clockFormatter(CLOCK_STAMP);

export interface EventDefinitionRow {
  id: string;
  name: string;
  displayName: string | null;
  conversion: boolean;
  lastSeenAt: string;
  archivedAt: string | null;
  count: number;
  visitors: number;
}

function scopeFields(scope: AnalyticsScope) {
  if (scope.projectId !== undefined) return { projectId: scope.projectId };
  if (scope.installWide) return { installWide: true };
  return {};
}

const invalidate = () =>
  queryClient.invalidateQueries({ queryKey: orpc.analytics.events.list.key() });

export function EventRow({ def, scope }: { def: EventDefinitionRow; scope: AnalyticsScope }) {
  const { t } = useTranslation();
  const update = useMutation(orpc.analytics.events.update.mutationOptions());
  const archive = useMutation(orpc.analytics.events.archive.mutationOptions());
  const isArchived = def.archivedAt !== null;
  const lastSeenMs = isoMs(def.lastSeenAt);

  const onError = () => toast.error(t("analytics.events.updateFailed"));

  return (
    <TableRow className={isArchived ? "opacity-50" : undefined}>
      <TableCell className="font-mono text-xs">{def.name}</TableCell>
      <TableCell>
        <Input
          key={`${def.id}-${def.displayName ?? ""}`}
          defaultValue={def.displayName ?? ""}
          placeholder={def.name}
          aria-label={t("analytics.events.displayName")}
          className="h-7 w-40 text-xs"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === (def.displayName ?? "")) return;
            update.mutate(
              { ...scopeFields(scope), id: def.id, displayName: next === "" ? null : next },
              {
                onSuccess: () => {
                  void invalidate();
                  toast.success(t("analytics.events.renamed"));
                },
                onError,
              },
            );
          }}
        />
      </TableCell>
      <TableCell>
        <Switch
          size="sm"
          checked={def.conversion}
          aria-label={t("analytics.events.conversion")}
          onCheckedChange={(next) =>
            update.mutate(
              { ...scopeFields(scope), id: def.id, conversion: next },
              { onSuccess: () => void invalidate(), onError },
            )
          }
        />
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatCount(def.count)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatCount(def.visitors)}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
        {lastSeenMs === null ? "–" : stamp(lastSeenMs)}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          disabled={archive.isPending}
          onClick={() =>
            archive.mutate(
              { ...scopeFields(scope), id: def.id, archived: !isArchived },
              {
                onSuccess: () => {
                  void invalidate();
                  toast.success(
                    t(isArchived ? "analytics.events.unarchived" : "analytics.events.archived"),
                  );
                },
                onError,
              },
            )
          }
        >
          {t(isArchived ? "analytics.events.unarchive" : "analytics.events.archive")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
