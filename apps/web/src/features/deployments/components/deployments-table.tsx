/**
 * The project-wide deployments table: status dot / resource / type / env /
 * what shipped / trigger / duration / created, icon actions on the right
 * (see `deployment-row.tsx`), and real pagination in the footer (range,
 * rows-per-page select, ‹ ›: the same idiom as the data studio's results
 * footer). Loading / error / empty states follow the audit table idiom.
 */

import { RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

import {
  DEPLOY_PAGE_SIZES,
  type DeployPageSize,
  type ProjectDeployment,
} from "../data/deployments-search";
import { DeployRow } from "./deployment-row";

function DeploymentsPending() {
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Range · rows-per-page · ‹ › — mirrors the data studio's results footer. */
function DeploymentsPager({
  page,
  size,
  total,
  count,
  isFetching,
  onPageChange,
  onSizeChange,
}: {
  page: number;
  size: DeployPageSize;
  total: number;
  /** Rows actually on this page (the last page is usually partial). */
  count: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onSizeChange: (size: DeployPageSize) => void;
}) {
  const { t } = useTranslation();
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = (page - 1) * size + count;
  const hasNext = last < total;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="font-mono">
        {formatNumber(total)} {t("deployments.deploymentsCount")}
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono">{total === 0 ? "0" : `${first}–${last}`}</span>
        <Select
          items={DEPLOY_PAGE_SIZES.map((s) => ({ label: `${s}/page`, value: String(s) }))}
          value={String(size)}
          onValueChange={(v) => {
            const next = DEPLOY_PAGE_SIZES.find((s) => String(s) === v);
            if (next) onSizeChange(next);
          }}
        >
          <SelectTrigger className="h-6 w-22 text-[11px]" aria-label={t("deployments.perPage")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPLOY_PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}/page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1 || isFetching}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("deployments.previousPage")}
        >
          ‹
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!hasNext || isFetching}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("deployments.nextPage")}
        >
          ›
        </Button>
      </div>
    </div>
  );
}

export function DeploymentsTableSection({
  items,
  total,
  page,
  size,
  isLoading,
  isError,
  isFetching,
  errorMessage,
  emptyVariant,
  onRetry,
  onOpen,
  onViewLogs,
  onRollback,
  onPageChange,
  onSizeChange,
}: {
  items: ProjectDeployment[];
  total: number;
  page: number;
  size: DeployPageSize;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  errorMessage?: string;
  /** Which honest empty-state copy applies: resource/status/search filters
   *  are narrowing ("filters"), only the time window is ("window"), or the
   *  project genuinely has no deployments ("none"). */
  emptyVariant: "filters" | "window" | "none";
  onRetry: () => void;
  onOpen: (d: ProjectDeployment) => void;
  onViewLogs: (d: ProjectDeployment) => void;
  onRollback: (d: ProjectDeployment) => void;
  onPageChange: (page: number) => void;
  onSizeChange: (size: DeployPageSize) => void;
}) {
  const { t } = useTranslation();
  if (isLoading) return <DeploymentsPending />;
  if (isError) {
    return (
      <ErrorState title="Couldn't load deployments" message={errorMessage} onRetry={onRetry} />
    );
  }
  if (!isFetching && items.length === 0 && page === 1) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={RocketIcon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>
            {emptyVariant === "filters"
              ? "Nothing matches these filters"
              : emptyVariant === "window"
                ? "No deployments in this window"
                : "No deployments yet"}
          </EmptyTitle>
          <EmptyDescription>
            {emptyVariant === "filters"
              ? "Try a wider time window, clear the search, or clear the filters."
              : emptyVariant === "window"
                ? "Widen the time window to see older deploys."
                : "Every build and deploy across this project lands here. Push to a connected repo, or deploy a resource from the graph."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 pl-4">{t("deployments.columns.status")}</TableHead>
            <TableHead className="w-32">{t("deployments.columns.resource")}</TableHead>
            <TableHead className="w-20">{t("deployments.columns.type")}</TableHead>
            <TableHead className="w-24">{t("deployments.columns.env")}</TableHead>
            <TableHead>{t("deployments.columns.shipped")}</TableHead>
            <TableHead className="w-36">{t("deployments.columns.trigger")}</TableHead>
            <TableHead className="w-20 text-right">{t("deployments.columns.duration")}</TableHead>
            <TableHead className="w-24 text-right">{t("deployments.columns.created")}</TableHead>
            <TableHead className="w-20 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <DeployRow
              key={d.id}
              d={d}
              onOpen={onOpen}
              onViewLogs={onViewLogs}
              onRollback={onRollback}
            />
          ))}
        </TableBody>
      </Table>
      <DeploymentsPager
        page={page}
        size={size}
        total={total}
        count={items.length}
        isFetching={isFetching}
        onPageChange={onPageChange}
        onSizeChange={onSizeChange}
      />
    </Card>
  );
}
