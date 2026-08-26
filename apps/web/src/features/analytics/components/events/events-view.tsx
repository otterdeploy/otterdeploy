/**
 * The Events view: every custom event the tracker has seen, with an inline
 * display name, the conversion flag that feeds the Goals card, and archive.
 * Definitions are discovered by the collector, not created here — so the
 * empty state teaches the two ways to send one.
 */

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useEventDefinitions,
} from "../../hooks/use-web-analytics";
import { EventRow } from "./event-row";

export function EventsView({ scope, win }: { scope: AnalyticsScope; win: AnalyticsWindowState }) {
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const query = useEventDefinitions(scope, win);

  const all = query.data?.definitions ?? [];
  const visible = showArchived ? all : all.filter((d) => d.archivedAt === null);

  if (query.isPending) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  if (all.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <EmptyTitle>{t("analytics.events.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("analytics.events.emptyBody")}</EmptyDescription>
        </EmptyHeader>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/50 p-3 text-left font-mono text-[12px] leading-relaxed">
          {'otter.track("signup", { plan: "pro" })\n<button data-otter-event="signup">…</button>'}
        </pre>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("analytics.events.count", { count: visible.length })}
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            id="analytics-show-archived"
            checked={showArchived}
            onCheckedChange={(next) => setShowArchived(next === true)}
          />
          <Label htmlFor="analytics-show-archived" className="text-xs font-normal">
            {t("analytics.events.showArchived")}
          </Label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("analytics.events.name")}</TableHead>
              <TableHead>{t("analytics.events.displayName")}</TableHead>
              <TableHead>{t("analytics.events.conversion")}</TableHead>
              <TableHead className="text-right">{t("analytics.events.events")}</TableHead>
              <TableHead className="text-right">{t("analytics.events.visitors")}</TableHead>
              <TableHead>{t("analytics.events.lastSeen")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((def) => (
              <EventRow key={def.id} def={def} scope={scope} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
