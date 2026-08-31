/**
 * Data: the SQL workbench, at its own address.
 *
 * It used to live inside a database resource's `?tab=data` panel. Two things
 * made that untenable. A side panel is a poor place to write SQL — the
 * full-screen `Dialog` it grew was the admission of that — and, decisively,
 * an external connection is not attached to any resource, so half of what the
 * workbench can now open had no panel to be opened from.
 *
 * So the workbench is a destination and the panel is a doorway: the Data tab
 * links here pre-scoped with `?target=`. One implementation, two ways in.
 *
 * `target` is in the URL, so a particular database is a link you can send
 * someone — which is the whole reason it is a search param and not state.
 */
import { useState } from "react";

import { Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { Page } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import { ConnectDialog } from "@/features/resources/components/postgres/tabs/data/components/connect-dialog";
import { TargetSwitcher } from "@/features/resources/components/postgres/tabs/data/components/target-switcher";
import {
  findTarget,
  useWorkbenchTargets,
} from "@/features/resources/components/postgres/tabs/data/data/use-workbench-targets";
import { DataWorkbench } from "@/features/resources/components/postgres/tabs/data/workbench";

const searchSchema = z.object({
  /** `resource:res_…` or `connection:dconn_…`; see data/target.ts. */
  target: z.string().optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/data")({
  validateSearch: searchSchema,
  component: DataPage,
});

function DataPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { managed, external, all, isLoading } = useWorkbenchTargets(organization.id);
  const [connectOpen, setConnectOpen] = useState(false);

  // Derived, not stored: an unknown or absent `?target=` falls back to the
  // first option rather than rendering an empty workbench.
  const active = findTarget(all, search.target);

  const connection = (
    <TargetSwitcher
      options={{ managed, external }}
      active={active}
      isLoading={isLoading}
      onPick={(option) => void navigate({ search: { target: option.key }, replace: true })}
      onConnect={() => setConnectOpen(true)}
    />
  );

  return (
    <Page className={active === undefined ? undefined : "min-h-0 gap-0 p-0 sm:p-0"}>
      {isLoading ? (
        <div className="min-h-[560px] flex-1 animate-pulse border-y bg-card" />
      ) : active === undefined ? (
        <Empty className="rounded-lg border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>Nothing to browse yet</EmptyTitle>
            <EmptyDescription>
              Deploy a PostgreSQL or MariaDB database, or connect one otterdeploy doesn&rsquo;t run.
            </EmptyDescription>
          </EmptyHeader>
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            Connect a database URL
          </Button>
        </Empty>
      ) : (
        <DataWorkbench
          // Remount on target change: the workbench holds per-database state
          // (open table, filters, page, editor buffer) that means nothing
          // against a different database, and carrying it across would show
          // one database's filters over another's rows.
          key={active.key}
          target={active.target}
          label={active.name}
          connection={connection}
          className="min-h-[560px] flex-1"
        />
      )}

      <ConnectDialog
        organizationId={organization.id}
        open={connectOpen}
        onOpenChange={setConnectOpen}
      />
    </Page>
  );
}
