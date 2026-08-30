/**
 * "Sources" view of the Firewall tab: manage the IP blocklists imported into
 * CrowdSec. Three parts: optional CrowdSec console enrollment, your active lists
 * (curated + custom, with sync status), and a catalog of one-click public lists.
 * No CrowdSec account required for any of the public/custom lists.
 */
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { blocklistsQuery } from "../data";
import { filterRows } from "../search";
import { AddCustomForm, ConsoleEnrollCard } from "./blocklists-panel-parts";

type Lists = Awaited<ReturnType<typeof orpc.firewall.blocklists.list.call>>;
type BlockList = Lists["lists"][number];
type CatalogEntry = Lists["catalog"][number];

export function BlocklistsPanel({ search }: { search: string }) {
  const { t } = useTranslation();
  // Shared options (../data). Lists change only when an operator changes
  // them, so this holds rather than polling; mutations refetch explicitly.
  const listQuery = useQuery(blocklistsQuery());
  const refetch = () => void listQuery.refetch();

  // The toolbar's search box is one box for the whole view, so it narrows
  // these two sections too rather than going inert on this tab.
  const lists = filterRows(listQuery.data?.lists ?? [], search, (l) => [l.name, l.url]);
  const catalog = filterRows(listQuery.data?.catalog ?? [], search, (c) => [
    c.name,
    c.description,
    c.url,
  ]);
  const searching = search.trim().length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        {/* Enrollment is setup, not a list — it has nothing to match, so a
            search that is narrowing lists hides it rather than leaving an
            unrelated card floating above the results. */}
        {searching ? null : <ConsoleEnrollCard />}

        {/* Active lists */}
        <section className="flex flex-col gap-3">
          <SectionTitle
            title={t("firewall.yourLists")}
            subtitle={t("firewall.yourListsSubtitle")}
          />
          {lists.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {searching
                ? "No list matches that search."
                : "No lists yet. Add a public one below, or your own URL."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="divide-y">
                {lists.map((l) => (
                  <ListRow key={l.id} list={l} onChanged={refetch} />
                ))}
              </div>
            </div>
          )}
          {searching ? null : <AddCustomForm onAdded={refetch} />}
        </section>

        {/* Catalog */}
        <section className="flex flex-col gap-3">
          <SectionTitle
            title={t("firewall.publicLists")}
            subtitle={t("firewall.publicListsSubtitle")}
          />
          {catalog.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No public list matches that search.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {catalog.map((c) => (
                <CatalogCard key={c.slug} entry={c} onAdded={refetch} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="text-[12px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function syncBadge(l: BlockList) {
  if (l.lastStatus === "ok")
    return (
      <Badge variant="outline" className="text-success">
        {l.lastCount ?? 0} IPs
      </Badge>
    );
  if (l.lastStatus === "error")
    return (
      <Badge variant="outline" className="text-destructive" title={l.lastError ?? undefined}>
        sync failed
      </Badge>
    );
  return <Badge variant="secondary">pending…</Badge>;
}

function ListRow({ list, onChanged }: { list: BlockList; onChanged: () => void }) {
  const { t } = useTranslation();
  const toggle = useMutation({
    ...orpc.firewall.blocklists.toggle.mutationOptions(),
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const sync = useMutation({
    ...orpc.firewall.blocklists.syncNow.mutationOptions(),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Imported ${r.count} IPs`);
      else toast.error(r.error ?? "Sync failed");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    ...orpc.firewall.blocklists.remove.mutationOptions(),
    onSuccess: () => {
      toast.success(`Removed ${list.name}`);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Switch
        checked={list.enabled}
        onCheckedChange={(enabled) => toggle.mutate({ id: list.id, enabled })}
        disabled={toggle.isPending}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13px] font-medium">{list.name}</span>
          {syncBadge(list)}
        </div>
        {/* Blocklist URLs are long and share a prefix, so a truncated one can
            read identically for two different lists; the full value stays
            recoverable on hover. */}
        <div className="truncate font-mono text-xs text-muted-foreground" title={list.url}>
          {list.url}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("firewall.syncNow")}
        title={t("firewall.syncNow")}
        onClick={() => sync.mutate({ id: list.id })}
        disabled={sync.isPending}
      >
        <HugeiconsIcon
          icon={RefreshIcon}
          strokeWidth={2}
          className={cn("size-3.5", sync.isPending && "animate-spin")}
        />
      </Button>
      <TypedConfirmDialog
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.remove")}
            title={t("common.remove")}
            disabled={remove.isPending}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
        title={`Remove ${list.name}?`}
        description={t("firewall.removeListDescription")}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: list.id })}
      />
    </div>
  );
}

function CatalogCard({ entry, onAdded }: { entry: CatalogEntry; onAdded: () => void }) {
  const add = useMutation({
    ...orpc.firewall.blocklists.enableCatalog.mutationOptions(),
    onSuccess: () => {
      toast.success(`Added ${entry.name}`);
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add"),
  });
  return (
    <Card className="flex flex-col gap-2 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold">{entry.name}</span>
        {entry.added ? (
          <Badge variant="outline" className="text-success">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="mr-1 size-3" />
            added
          </Badge>
        ) : (
          <Button
            size="xs"
            variant="outline"
            onClick={() => add.mutate({ slug: entry.slug })}
            disabled={add.isPending}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3" />
            Add
          </Button>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{entry.description}</p>
    </Card>
  );
}
