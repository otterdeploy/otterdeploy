/**
 * "Sources" view of the Firewall tab — manage the IP blocklists imported into
 * CrowdSec. Three parts: optional CrowdSec console enrollment, your active lists
 * (curated + custom, with sync status), and a catalog of one-click public lists.
 * No CrowdSec account required for any of the public/custom lists.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

type Lists = Awaited<ReturnType<typeof orpc.firewall.blocklists.list.call>>;
type BlockList = Lists["lists"][number];
type CatalogEntry = Lists["catalog"][number];

export function BlocklistsPanel() {
  const listQuery = useQuery({
    ...orpc.firewall.blocklists.list.queryOptions(),
    refetchInterval: 10_000,
  });
  const refetch = () => void listQuery.refetch();

  const lists = listQuery.data?.lists ?? [];
  const catalog = listQuery.data?.catalog ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <ConsoleEnrollCard />

        {/* Active lists */}
        <section className="flex flex-col gap-3">
          <SectionTitle
            title="Your lists"
            subtitle="Public + custom lists imported into CrowdSec on a schedule."
          />
          {lists.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No lists yet — add a public one below, or your own URL.
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
          <AddCustomForm onAdded={refetch} />
        </section>

        {/* Catalog */}
        <section className="flex flex-col gap-3">
          <SectionTitle
            title="Public blocklists"
            subtitle="Well-known free lists — no CrowdSec account needed. One click to add."
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {catalog.map((c) => (
              <CatalogCard key={c.slug} entry={c} onAdded={refetch} />
            ))}
          </div>
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
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{list.name}</span>
          {syncBadge(list)}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {list.url}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Sync now"
        title="Sync now"
        onClick={() => sync.mutate({ id: list.id })}
        disabled={sync.isPending}
      >
        <HugeiconsIcon
          icon={RefreshIcon}
          strokeWidth={2}
          className={cn("size-3.5", sync.isPending && "animate-spin")}
        />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Remove"
        title="Remove"
        onClick={() => {
          if (window.confirm(`Remove "${list.name}" and its imported IPs?`))
            remove.mutate({ id: list.id });
        }}
        disabled={remove.isPending}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
      </Button>
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
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {entry.description}
      </p>
    </Card>
  );
}

function AddCustomForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const add = useMutation({
    ...orpc.firewall.blocklists.addCustom.mutationOptions(),
    onSuccess: () => {
      toast.success("List added — importing…");
      setName("");
      setUrl("");
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add list"),
  });
  const valid = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate({ name: name.trim(), url: url.trim() });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="List name"
        className="h-8 w-40 text-[12px]"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/blocklist.txt"
        className="h-8 min-w-0 flex-1 font-mono text-[12px]"
      />
      <Button type="submit" size="sm" disabled={!valid || add.isPending}>
        {add.isPending ? "Adding…" : "Add custom list"}
      </Button>
    </form>
  );
}

function ConsoleEnrollCard() {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const enroll = useMutation({
    ...orpc.firewall.console.enroll.mutationOptions(),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      setKey("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Enrollment failed"),
  });
  return (
    <Card className="flex flex-col gap-2 border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">CrowdSec Console (optional)</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Free account at{" "}
            <a
              href="https://app.crowdsec.net"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              app.crowdsec.net
            </a>{" "}
            — unlocks the larger community blocklist + curated lists. The public
            lists above need no account.
          </p>
        </div>
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Enroll
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="flex flex-wrap items-center gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) enroll.mutate({ key: key.trim() });
          }}
        >
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enrollment key from the console"
            className="h-8 min-w-0 flex-1 font-mono text-[12px]"
          />
          <Button type="submit" size="sm" disabled={key.trim().length < 8 || enroll.isPending}>
            {enroll.isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
