/**
 * Variables — Infisical-style overview matrix + per-env table + bulk-edit
 * modal + sync integrations. UI structure ported from
 * apps/web-demo/src/features/otterdeploy/screens/env.tsx; data wired to
 * `orpc.project.envVar.{list,upsert,delete,bulkReplace}`.
 *
 * Tabs are dynamic — one per project environment (whatever slugs the
 * org has set up, not the hard-coded production/staging/preview). The
 * Sync tab still renders a static provider list — the sync-source
 * backend is a separate Plan 7 follow-up.
 */

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation, useQueries } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AddSquareIcon,
  ArrowDown01Icon,
  BalanceScaleIcon,
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  FilterIcon,
  Key01Icon,
  Link01Icon,
  Refresh01Icon,
  RemoveCircleIcon,
  Search01Icon,
  Settings01Icon,
  Tick02Icon,
  Upload01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { envCollection } from "@/features/projects/data/env";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/variables")({
  staticData: { crumb: "Variables" },
  component: VariablesRoute,
});

// ────── Shared types ──────

type CellStatus = "set" | "missing" | "empty";

interface EnvironmentRef {
  id: string;
  slug: string;
  name: string;
}

interface EnvVarRow {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
}

// ────── Sync providers — static for now (Plan 7) ──────

interface SyncProvider {
  id: string;
  name: string;
  sub: string;
  connected: boolean;
  last?: string;
  count?: number;
  envSlug?: string;
}

const SYNC_PROVIDERS: SyncProvider[] = [
  { id: "infisical", name: "Infisical", sub: "Open-source secret manager", connected: true, last: "2m ago", count: 17, envSlug: "production" },
  { id: "vault", name: "HashiCorp Vault", sub: "Self-hosted, dynamic secrets", connected: false },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "KMS-backed cloud secrets", connected: false },
  { id: "doppler", name: "Doppler", sub: "SaaS secret platform", connected: true, last: "1h ago", count: 12, envSlug: "staging" },
  { id: "1password", name: "1Password Connect", sub: "Vault-based, audit-friendly", connected: false },
  { id: "gcp-sm", name: "Google Secret Manager", sub: "GCP-native", connected: false },
];

// ────── Route ──────

function VariablesRoute() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const projectId = project.id;

  // All envs for this project, slug-sorted so the tab order is stable
  // across renders (the collection isn't intrinsically ordered).
  const { data: environments = [] } = useLiveQuery(
    (q) =>
      q
        .from({ e: envCollection })
        .where(({ e }) => eq(e.projectId, projectId))
        .orderBy(({ e }) => e.slug),
    [projectId],
  );

  // One env-var list query per environment, in parallel. The orpc query
  // key is keyed on (projectId, environmentId), so the cache buckets
  // automatically.
  const envVarQueries = useQueries({
    queries: environments.map((env) =>
      orpc.project.envVar.list.queryOptions({
        input: {
          projectId: projectId as never,
          environmentId: env.id as never,
        },
      }),
    ),
  });

  // Map<envId, EnvVarRow[]> — what each tab renders. Used by the
  // overview matrix to compute per-cell status too.
  const byEnv = useMemo(() => {
    const map = new Map<string, EnvVarRow[]>();
    environments.forEach((env, i) => {
      map.set(env.id, (envVarQueries[i]?.data ?? []) as EnvVarRow[]);
    });
    return map;
  }, [environments, envVarQueries]);

  // Union of every key seen in any env — the rows of the overview
  // matrix. Sorted alphabetically so the order matches the demo.
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    for (const rows of byEnv.values()) {
      for (const r of rows) set.add(r.key);
    }
    return Array.from(set).sort();
  }, [byEnv]);

  const envRefs: EnvironmentRef[] = environments.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
  }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="overview" className="flex flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="h-10 w-full justify-start gap-1 px-4"
        >
          <TabsTrigger value="overview" className="gap-1.5">
            <HugeiconsIcon icon={BalanceScaleIcon} className="size-3.5" />
            Overview
          </TabsTrigger>
          {envRefs.map((env) => {
            const count = byEnv.get(env.id)?.length ?? 0;
            return (
              <TabsTrigger key={env.id} value={env.id} className="gap-1.5 capitalize">
                {env.name || env.slug}
                {count > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 rounded-sm px-1.5 font-mono text-[10px]">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="sync" className="gap-1.5">
            <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" />
            Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-auto">
          <OverviewMatrix envs={envRefs} byEnv={byEnv} allKeys={allKeys} />
        </TabsContent>
        {envRefs.map((env) => (
          <TabsContent key={env.id} value={env.id} className="flex-1 overflow-auto">
            <PerEnvTable
              projectId={projectId}
              env={env}
              rows={byEnv.get(env.id) ?? []}
            />
          </TabsContent>
        ))}
        <TabsContent value="sync" className="flex-1 overflow-auto">
          <SyncIntegrations />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────── Overview matrix ──────

function cellStatus(rows: EnvVarRow[], key: string): CellStatus {
  const row = rows.find((r) => r.key === key);
  if (!row) return "missing";
  return row.value === "" ? "empty" : "set";
}

function OverviewMatrix({
  envs,
  byEnv,
  allKeys,
}: {
  envs: EnvironmentRef[];
  byEnv: Map<string, EnvVarRow[]>;
  allKeys: string[];
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = allKeys.filter((k) => !q || k.toLowerCase().includes(q.toLowerCase()));

  // Count defined keys per env — every row counts (both `set` and
  // `empty`); only `missing` (no row) doesn't contribute.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const env of envs) {
      out.set(env.id, (byEnv.get(env.id) ?? []).length);
    }
    return out;
  }, [envs, byEnv]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered));
  };

  if (envs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-muted-foreground">
        This project has no environments. Create one to start adding variables.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Project overview</h2>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5">
          <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
          Filters
        </Button>
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by secret or folder name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-72 pl-8"
          />
        </div>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Inject secrets via the <code className="font-mono text-foreground/80">otterdeploy</code> CLI,
        runtime API, or build-time env-injection. Switch to an environment tab to add or edit values.
      </p>

      <div className="overflow-hidden rounded-md border bg-card">
        <div
          className="grid items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: `28px 1fr 28px repeat(${envs.length}, minmax(96px, 1fr))` }}
        >
          <Checkbox
            checked={selected.size > 0 && selected.size === filtered.length}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <span className="flex items-center gap-1">
            Name <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-50" />
          </span>
          <span />
          {envs.map((env) => (
            <span key={env.id} className="flex items-center gap-1.5 capitalize">
              {env.name || env.slug}
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {counts.get(env.id) ?? 0}
              </span>
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {allKeys.length === 0
              ? "No variables defined yet. Open an environment to add one."
              : "No keys match this search."}
          </div>
        ) : (
          filtered.map((key) => (
            <div
              key={key}
              className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
              style={{ gridTemplateColumns: `28px 1fr 28px repeat(${envs.length}, minmax(96px, 1fr))` }}
            >
              <Checkbox
                checked={selected.has(key)}
                onCheckedChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                aria-label={`Select ${key}`}
              />
              <span className="flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={Key01Icon}
                  className="size-3 text-muted-foreground/70"
                />
                <span className="font-mono text-xs font-medium">{key}</span>
              </span>
              <span />
              {envs.map((env) => (
                <span key={env.id} className="flex items-center">
                  <StatusGlyph status={cellStatus(byEnv.get(env.id) ?? [], key)} />
                </span>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <HugeiconsIcon icon={Key01Icon} className="size-3" />
        <span>{filtered.length}</span>
        <div className="flex-1" />
        <span className="font-mono">1 – {filtered.length} of {filtered.length}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">Legend</span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="set" /> set with value
        </span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="empty" /> defined, empty
        </span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="missing" /> not defined in this env
        </span>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: CellStatus }) {
  if (status === "set") {
    return (
      <HugeiconsIcon
        icon={Tick02Icon}
        className="size-3.5 text-emerald-500"
        aria-label="set"
      />
    );
  }
  if (status === "missing") {
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        className="size-3.5 text-rose-500"
        aria-label="missing"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={RemoveCircleIcon}
      className="size-3 text-amber-500"
      aria-label="empty"
    />
  );
}

// ────── Per-env table ──────

function PerEnvTable({
  projectId,
  env,
  rows,
}: {
  projectId: string;
  env: EnvironmentRef;
  rows: EnvVarRow[];
}) {
  const [q, setQ] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const filtered = rows.filter((r) => !q || r.key.toLowerCase().includes(q.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.key)));
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.project.envVar.list.queryKey({
        input: {
          projectId: projectId as never,
          environmentId: env.id as never,
        },
      }),
    });
  };

  const deleteMut = useMutation({
    ...orpc.project.envVar.delete.mutationOptions(),
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => toast.error(err.message ?? "Couldn't delete"),
  });

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by secret, folder, tag or metadata…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 pl-8"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
          Filters
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-8" aria-label="Download .env">
          <HugeiconsIcon icon={Download01Icon} className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={revealAll ? "Hide secrets" : "Reveal secrets"}
          onClick={() => setRevealAll((r) => !r)}
        >
          <HugeiconsIcon icon={ViewIcon} className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
          Bulk edit
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <HugeiconsIcon icon={AddSquareIcon} className="size-3.5" />
          Add secret
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="grid grid-cols-[32px_24px_1fr_2fr_120px] items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Checkbox
            checked={selected.size > 0 && selected.size === filtered.length}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <span />
          <span className="flex items-center gap-1">
            Key <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-50" />
          </span>
          <span className="border-l pl-3">Value</span>
          <span />
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-muted-foreground">
            {rows.length === 0
              ? `No variables in ${env.name || env.slug}. Use Bulk edit to paste a .env block.`
              : "No keys match this search."}
          </div>
        ) : (
          filtered.map((r) => (
            <div
              key={r.id}
              className="group grid grid-cols-[32px_24px_1fr_2fr_120px] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
            >
              <Checkbox
                checked={selected.has(r.key)}
                onCheckedChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(r.key)) next.delete(r.key);
                    else next.add(r.key);
                    return next;
                  })
                }
                aria-label={`Select ${r.key}`}
              />
              <HugeiconsIcon
                icon={Key01Icon}
                className="size-3 text-muted-foreground/70"
              />
              <span className="font-mono text-xs font-medium">{r.key}</span>
              <span className="min-w-0 truncate border-l pl-3">
                {r.value === "" ? (
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60">
                    EMPTY
                  </span>
                ) : (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      r.isSecret && !revealAll
                        ? "text-muted-foreground"
                        : "text-foreground/85",
                    )}
                  >
                    {r.isSecret && !revealAll ? "••••••••••••••••••••••••••••" : r.value}
                  </span>
                )}
              </span>
              <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(r.value);
                    toast.success(`Copied ${r.key}`);
                  }}
                >
                  <HugeiconsIcon icon={Copy01Icon} className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-rose-500 hover:text-rose-500"
                  title="Delete"
                  disabled={deleteMut.isPending}
                  onClick={() =>
                    deleteMut.mutate({
                      projectId: projectId as never,
                      environmentId: env.id as never,
                      key: r.key,
                    })
                  }
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                </Button>
              </span>
            </div>
          ))
        )}

        <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <HugeiconsIcon icon={Key01Icon} className="size-3" />
          <span>{filtered.length}</span>
          <div className="flex-1" />
          <span className="font-mono">1 – {filtered.length} of {filtered.length}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/10 px-6 py-8 text-center">
        <HugeiconsIcon
          icon={Upload01Icon}
          className="size-5 text-muted-foreground"
        />
        <div className="text-sm text-foreground/80">
          Paste or drag a <code className="font-mono">.env</code> block into bulk edit.
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
          Open bulk edit
        </Button>
      </div>

      <BulkEditDialog
        projectId={projectId}
        env={env}
        currentRows={rows}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSaved={invalidate}
      />
    </div>
  );
}

// ────── Bulk edit ──────

interface ParsedVar {
  key: string;
  value: string;
  isSecret: boolean;
}

function BulkEditDialog({
  projectId,
  env,
  currentRows,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  env: EnvironmentRef;
  currentRows: EnvVarRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => currentRows.map((v) => `${v.key}=${v.value}`).join("\n"),
    [currentRows],
  );
  const [text, setText] = useState(initial);

  // Re-hydrate when the dialog opens or the rows refetch so a stale
  // edit doesn't persist between visits to the same env tab.
  useEffect(() => {
    setText(initial);
  }, [initial]);

  const parsed = useMemo<ParsedVar[]>(() => {
    const out: ParsedVar[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      let k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k.startsWith("export ")) k = k.slice(7).trim();
      out.push({ key: k, value: v, isSecret: /SECRET|KEY|TOKEN|PASS|DSN/i.test(k) });
    }
    return out;
  }, [text]);

  const bulkMut = useMutation({
    ...orpc.project.envVar.bulkReplace.mutationOptions(),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      toast.success(`Saved ${parsed.length} variables to ${env.name || env.slug}`);
    },
    onError: (err) => toast.error(err.message ?? "Couldn't save"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-baseline gap-2 text-sm font-semibold">
            Bulk edit
            <span className="font-mono text-xs font-normal text-muted-foreground capitalize">
              · {env.name || env.slug}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Paste a .env, or edit inline
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_280px] divide-x">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-[11px]">
              <span className="text-muted-foreground">
                .env format · # comments ok · KEY=value
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() =>
                  navigator.clipboard
                    ?.readText()
                    .then((t) => setText(t))
                    .catch(() => {})
                }
              >
                Paste from clipboard
              </Button>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="min-h-[360px] resize-none rounded-none border-0 bg-muted/20 font-mono text-xs leading-7"
            />
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Target environment
              </div>
              <div className="flex items-center gap-2 text-xs">
                <EnvDot slug={env.slug} />
                <span className="capitalize">{env.name || env.slug}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Cross-env apply is a follow-up. Bulk replace runs against this env only.
              </p>
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Preview
              </div>
              <div className="font-mono text-xs text-foreground/80">
                {parsed.length} variables parsed
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {parsed.filter((p) => p.isSecret).length} marked secret
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="min-h-0">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Detected
              </div>
              <div className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/80">
                {parsed.slice(0, 12).map((p) => (
                  <div key={p.key} className="flex gap-1.5 py-0.5">
                    <span className={p.isSecret ? "text-amber-500" : "text-muted-foreground"}>
                      {p.isSecret ? "••" : "  "}
                    </span>
                    <span className="truncate">{p.key}</span>
                  </div>
                ))}
                {parsed.length > 12 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{parsed.length - 12} more
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="text-[11px] text-muted-foreground">
            Replaces every variable in {env.name || env.slug} atomically.
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={bulkMut.isPending}
            onClick={() =>
              bulkMut.mutate({
                projectId: projectId as never,
                environmentId: env.id as never,
                vars: parsed.map((p) => ({
                  key: p.key,
                  value: p.value,
                  isSecret: p.isSecret,
                })),
              })
            }
          >
            {bulkMut.isPending ? "Saving…" : `Apply ${parsed.length} vars →`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvDot({ slug }: { slug: string }) {
  // Slug-based tone — production/main → emerald, staging → amber,
  // anything else (preview / feature branches) → blue.
  const tone =
    slug === "production" || slug === "main" || slug === "prod"
      ? "bg-emerald-500"
      : slug === "staging" || slug === "stage" || slug === "stg"
        ? "bg-amber-500"
        : "bg-blue-500";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}

// ────── Sync integrations (still mocked — separate backend) ──────

function SyncIntegrations() {
  const [providers, setProviders] = useState<SyncProvider[]>(SYNC_PROVIDERS);
  const connected = providers.filter((p) => p.connected).length;

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Sync sources</h2>
          <p className="text-xs text-muted-foreground">
            Pull secrets from an external manager into any environment. Changes flow one-way.
          </p>
        </div>
        <Button variant="outline" size="sm">
          Read docs
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Connected" value={`${connected} / ${providers.length}`} />
        <StatCard label="Syncing" value={String(connected)} sub="every 60s" />
        <StatCard label="Last sync" value="2m ago" sub="all sources up-to-date" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            onConnect={() =>
              setProviders((ps) =>
                ps.map((x) =>
                  x.id === p.id
                    ? { ...x, connected: true, last: "just now", count: 0, envSlug: "production" }
                    : x,
                ),
              )
            }
            onDisconnect={() =>
              setProviders((ps) =>
                ps.map((x) =>
                  x.id === p.id
                    ? { ...x, connected: false, last: undefined, count: undefined }
                    : x,
                ),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-xl font-medium">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub ?? " "}</div>
    </div>
  );
}

function ProviderCard({
  p,
  onConnect,
  onDisconnect,
}: {
  p: SyncProvider;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-md border bg-muted/30">
          <ProviderLogo id={p.id} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{p.name}</span>
            {p.connected ? (
              <Badge
                variant="outline"
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-500"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                connected
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                not connected
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{p.sub}</div>
        </div>
      </div>

      {p.connected && (
        <div className="flex items-center gap-4 border-t pt-3 text-[11px]">
          <Stat label="last sync" value={p.last ?? ""} />
          <Stat label="syncing" value={`${p.count ?? 0} secrets`} />
          {p.envSlug && (
            <Stat
              label="target env"
              value={
                <span className="flex items-center gap-1 capitalize">
                  <EnvDot slug={p.envSlug} /> {p.envSlug}
                </span>
              }
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {p.connected ? (
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <HugeiconsIcon icon={Settings01Icon} className="size-3" />
              Configure
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <HugeiconsIcon icon={Refresh01Icon} className="size-3" />
              Sync now
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-500 hover:text-rose-500"
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" className="gap-1.5" onClick={onConnect}>
              <HugeiconsIcon icon={Link01Icon} className="size-3" />
              Connect
            </Button>
            <Button variant="ghost" size="sm">
              Setup guide
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1 font-mono text-xs text-foreground/80">
        {value}
      </div>
    </div>
  );
}

function ProviderLogo({ id }: { id: string }) {
  const base = "grid size-5 place-items-center rounded font-mono text-[10px] font-bold";
  if (id === "infisical") return <div className={cn(base, "bg-yellow-400 text-black")}>i</div>;
  if (id === "vault") return <div className={cn(base, "bg-black text-yellow-400")}>V</div>;
  if (id === "aws-sm") return <div className={cn(base, "bg-slate-900 text-orange-400 text-[8px]")}>aws</div>;
  if (id === "doppler") return <div className={cn(base, "bg-blue-600 text-white")}>D</div>;
  if (id === "1password") return <div className={cn(base, "rounded-full bg-blue-500 text-white")}>1</div>;
  if (id === "gcp-sm") return <div className={cn(base, "border border-blue-500 bg-white text-blue-500 text-[8px]")}>GCP</div>;
  return <Switch />;
}
