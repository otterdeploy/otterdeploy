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
import { useEffect, useState } from "react";

import { createPortal } from "react-dom";

import { Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import { ConnectDialog } from "@/features/resources/components/postgres/tabs/data/components/connect-dialog";
import { TargetSwitcher } from "@/features/resources/components/postgres/tabs/data/components/target-switcher";
import {
  findTarget,
  useWorkbenchTargets,
} from "@/features/resources/components/postgres/tabs/data/data/use-workbench-targets";
import type { WorkbenchUrlState } from "@/features/resources/components/postgres/tabs/data/data/url-state";

import {
  searchFromUrlState,
  urlStateFromSearch,
} from "@/features/resources/components/postgres/tabs/data/data/url-state";
import { DataWorkbench } from "@/features/resources/components/postgres/tabs/data/workbench";

const searchSchema = z.object({
  /** `resource:res_…` or `connection:dconn_…`; see data/target.ts. */
  target: z.string().optional(),
  /** Browse state — `schema.name`, JSON filters/sorts, paging. url-state.ts. */
  table: z.string().optional(),
  filters: z.string().optional(),
  sorts: z.string().optional(),
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/data")({
  validateSearch: searchSchema,
  component: DataPage,
});

function DataPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { managed, external, all, isLoading } = useWorkbenchTargets();
  const [connectOpen, setConnectOpen] = useState(false);

  // Derived, not stored: an unknown or absent `?target=` falls back to the
  // first option rather than rendering an empty workbench.
  const active = findTarget(all, search.target);

  // Captured ONCE: the workbench seeds its state from this at mount, then owns
  // it; later URL echoes must not feed back in. Pinned to the target it was
  // read for, so switching databases starts the new one clean.
  const [initial] = useState(() => ({
    forTarget: search.target,
    state: urlStateFromSearch(search),
  }));
  const onUrlState = (state: WorkbenchUrlState) => {
    void navigate({ search: (prev) => ({ ...prev, ...searchFromUrlState(state) }), replace: true });
  };

  const switcher = (
    <TargetSwitcher
      options={{ managed, external }}
      active={active}
      isLoading={isLoading}
      onPick={(option) => void navigate({ search: { target: option.key }, replace: true })}
      onConnect={() => setConnectOpen(true)}
    />
  );

  // The switcher joins the header's crumb trail — `acme / otterdeploy-local` —
  // instead of squatting at the top of the rail: which database you are in is
  // the same species of fact as which org, and it belongs in the same row. The
  // slot is grabbed after mount because the portal target renders in a
  // different subtree of the same layout.
  const [crumbSlot, setCrumbSlot] = useState<Element | null>(null);
  useEffect(() => {
    setCrumbSlot(document.getElementById("site-header-crumb-slot"));
  }, []);
  const headerCrumb =
    crumbSlot === null
      ? null
      : createPortal(
          <>
            <span aria-hidden className="px-1 text-base text-muted-foreground/40 select-none">
              /
            </span>
            {switcher}
          </>,
          crumbSlot,
        );

  // Full-bleed, no Page gutter and no card: this is an instrument surface, the
  // exception Page's own docs carve out for Terminal and Edge logs. A database
  // browser boxed inside page padding wastes the two dimensions it needs most,
  // and the rail reads as part of the app rather than as a widget on a page.
  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden">
      {headerCrumb}
      {isLoading ? (
        <div className="min-h-0 flex-1 animate-pulse bg-muted/20" />
      ) : active === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Empty className="flex-1 justify-center">
            <EmptyHeader>
              <HugeiconsIcon
                icon={Database02Icon}
                strokeWidth={1.5}
                className="size-10 text-muted-foreground/50"
              />
              <EmptyTitle>Nothing to browse yet</EmptyTitle>
              <EmptyDescription>
                Deploy a PostgreSQL or MariaDB database, or connect one otterdeploy
                doesn&rsquo;t run.
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              Connect a database URL
            </Button>
          </Empty>
        </div>
      ) : (
        <DataWorkbench
          // Remount on target change: the workbench holds per-database state
          // (open table, filters, page, editor buffer) that means nothing
          // against a different database, and carrying it across would show
          // one database's filters over another's rows.
          key={active.key}
          target={active.target}
          label={active.name}
          urlInit={
            initial.forTarget === undefined || initial.forTarget === active.key
              ? initial.state
              : undefined
          }
          onUrlState={onUrlState}
          className="min-h-0 flex-1"
        />
      )}

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
