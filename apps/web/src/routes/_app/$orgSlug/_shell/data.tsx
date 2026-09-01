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

import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { ConnectDialog } from "@/features/resources/components/postgres/tabs/data/components/connect-dialog";
import { ConnectGate } from "@/features/resources/components/postgres/tabs/data/components/connect-gate";
import { TargetPicker } from "@/features/resources/components/postgres/tabs/data/components/target-picker";
import { TargetSwitcher } from "@/features/resources/components/postgres/tabs/data/components/target-switcher";
import type { DataConnection } from "@/features/resources/components/postgres/tabs/data/data/connections";
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
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { managed, external, all, isLoading } = useWorkbenchTargets(organization.id);
  const [dialog, setDialog] = useState<ConnectDialogState>({ open: false, opening: 0 });
  // Each opening gets a fresh dialog (see `key` below): the draft is state the
  // dialog owns, and a form that remembers the last connection's name — or
  // the last edit's target — when you come back to add another is a bug.
  const openConnect = () =>
    setDialog((d) => ({ open: true, opening: d.opening + 1, existing: undefined }));
  const openEdit = (existing: DataConnection) =>
    setDialog((d) => ({ open: true, opening: d.opening + 1, existing }));
  // Closing keeps `existing` so the dialog's exit animation shows the same
  // content it opened with, rather than snapping back to the create form.
  const setDialogOpen = (open: boolean) => setDialog((d) => ({ ...d, open }));

  // Derived, not stored. No `?target=` means nothing is open and the picker
  // shows; opening a database is a click, because it opens a session.
  const active = findTarget(all, search.target);
  const pick = (option: { key: string }) =>
    void navigate({ search: { target: option.key }, replace: true });
  const leave = () => void navigate({ search: {}, replace: true });

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
      onPick={pick}
      onConnect={openConnect}
      onEdit={openEdit}
      onDisconnect={active === undefined ? undefined : leave}
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
        <TargetPicker managed={managed} external={external} onPick={pick} onConnect={openConnect} />
      ) : (
        <ConnectGate
          // Remount on target change: the session and the workbench's
          // per-database state (open table, filters, page, editor buffer)
          // both belong to one database.
          key={active.key}
          target={active.target}
          name={active.name}
          onChooseAnother={leave}
        >
          <DataWorkbench
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
        </ConnectGate>
      )}

      <ConnectDialog
        key={dialog.opening}
        organizationId={organization.id}
        open={dialog.open}
        onOpenChange={setDialogOpen}
        existing={dialog.existing}
      />
    </div>
  );
}

interface ConnectDialogState {
  open: boolean;
  /** Bumped on every open; remounts the dialog so it starts from a clean draft. */
  opening: number;
  /** The connection being edited, or undefined for "connect a new one". */
  existing?: DataConnection;
}
