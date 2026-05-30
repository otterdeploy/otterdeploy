/**
 * Variables — Infisical-style overview matrix + per-env table + bulk-edit
 * modal + sync integrations. Ported from
 * apps/web-demo/src/features/otterdeploy/screens/env.tsx, translated
 * from the demo's bespoke `os-*` CSS classes onto shadcn / Tailwind so
 * the page reads in the same idiom as the rest of apps/web.
 *
 * All data is currently mocked (matches the demo). Wiring to a real
 * `project.variable.list` / write API is a follow-up — the backend
 * ships in Plan 6 per the demo's notes.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  AddSquareIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  FilterIcon,
  FlashIcon,
  GitBranchIcon,
  Key01Icon,
  Link01Icon,
  Refresh01Icon,
  RemoveCircleIcon,
  BalanceScaleIcon,
  Search01Icon,
  Settings01Icon,
  Tick02Icon,
  Upload01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/variables")({
  staticData: { crumb: "Variables" },
  component: VariablesRoute,
});

// ────── Mock data — ported verbatim from apps/web-demo/features/otterdeploy/data.ts ──────

type EnvName = "production" | "staging" | "preview";
type CellStatus = "set" | "missing" | "empty";

interface EnvOverviewKey {
  k: string;
  secret: boolean;
  status: Record<EnvName, CellStatus>;
}

const ENVS: EnvName[] = ["production", "staging", "preview"];

const ENV_OVERVIEW_KEYS: EnvOverviewKey[] = [
  { k: "ADMIN_ALLOWED_EMAILS", secret: false, status: { production: "empty", staging: "empty", preview: "empty" } },
  { k: "APPLE_APP_BUNDLE_ID", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "APPLE_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_KEY_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_PRIVATE_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "APPLE_TEAM_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "BETTER_AUTH_SECRET", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "BETTER_AUTH_URL", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "CORS_ORIGIN", secret: true, status: { production: "set", staging: "missing", preview: "missing" } },
  { k: "DATABASE_URL", secret: true, status: { production: "set", staging: "set", preview: "set" } },
  { k: "GEMINI_API_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "GOOGLE_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "GOOGLE_CLIENT_SECRET", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "MICROSOFT_CLIENT_ID", secret: false, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "MICROSOFT_CLIENT_SECRET", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "OPENROUTER_API_KEY", secret: true, status: { production: "empty", staging: "missing", preview: "missing" } },
  { k: "VITE_SERVER_URL", secret: false, status: { production: "set", staging: "missing", preview: "missing" } },
];

interface SyncProvider {
  id: string;
  name: string;
  sub: string;
  connected: boolean;
  last?: string;
  count?: number;
  env?: EnvName;
}

const SYNC_PROVIDERS: SyncProvider[] = [
  { id: "infisical", name: "Infisical", sub: "Open-source secret manager", connected: true, last: "2m ago", count: 17, env: "production" },
  { id: "vault", name: "HashiCorp Vault", sub: "Self-hosted, dynamic secrets", connected: false },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "KMS-backed cloud secrets", connected: false },
  { id: "doppler", name: "Doppler", sub: "SaaS secret platform", connected: true, last: "1h ago", count: 12, env: "staging" },
  { id: "1password", name: "1Password Connect", sub: "Vault-based, audit-friendly", connected: false },
  { id: "gcp-sm", name: "Google Secret Manager", sub: "GCP-native", connected: false },
];

// ────── Route ──────

function VariablesRoute() {
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
          {ENVS.map((e) => (
            <TabsTrigger key={e} value={e} className="gap-1.5 capitalize">
              {e}
              {(e === "production" || e === "staging") && (
                <Badge variant="secondary" className="ml-1 h-4 rounded-sm px-1.5 font-mono text-[10px]">
                  17
                </Badge>
              )}
            </TabsTrigger>
          ))}
          <TabsTrigger value="sync" className="gap-1.5">
            <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" />
            Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-auto">
          <OverviewMatrix />
        </TabsContent>
        {ENVS.map((e) => (
          <TabsContent key={e} value={e} className="flex-1 overflow-auto">
            <PerEnvTable env={e} />
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

function OverviewMatrix() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = ENV_OVERVIEW_KEYS.filter(
    (r) => !q || r.k.toLowerCase().includes(q.toLowerCase()),
  );

  const counts = useMemo(() => {
    const out: Record<EnvName, number> = { production: 0, staging: 0, preview: 0 };
    for (const r of ENV_OVERVIEW_KEYS) {
      for (const e of ENVS) {
        if (r.status[e] === "set" || r.status[e] === "empty") out[e]++;
      }
    }
    return out;
  }, []);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.k)));
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Project Overview</h2>
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
        <Button size="sm" className="gap-1.5">
          <HugeiconsIcon icon={AddSquareIcon} className="size-3.5" />
          Add secret
        </Button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Inject secrets via the <code className="font-mono text-foreground/80">otterdeploy</code> CLI,
        runtime API, or build-time env-injection. Click any environment to see and edit values.
      </p>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="grid grid-cols-[28px_1fr_28px_repeat(3,minmax(96px,1fr))] items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Checkbox
            checked={selected.size > 0 && selected.size === filtered.length}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <span className="flex items-center gap-1">
            Name <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-50" />
          </span>
          <span />
          {ENVS.map((e) => (
            <span key={e} className="flex items-center gap-1.5 capitalize">
              {e}
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {counts[e]}
              </span>
            </span>
          ))}
        </div>
        {filtered.map((r) => (
          <div
            key={r.k}
            className="grid grid-cols-[28px_1fr_28px_repeat(3,minmax(96px,1fr))] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
          >
            <Checkbox
              checked={selected.has(r.k)}
              onCheckedChange={() =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(r.k)) next.delete(r.k);
                  else next.add(r.k);
                  return next;
                })
              }
              aria-label={`Select ${r.k}`}
            />
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Key01Icon}
                className="size-3 text-muted-foreground/70"
              />
              <span className="font-mono text-xs font-medium">{r.k}</span>
            </span>
            <span />
            {ENVS.map((e) => (
              <span key={e} className="flex items-center">
                <StatusGlyph status={r.status[e]} />
              </span>
            ))}
          </div>
        ))}
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

function PerEnvTable({ env }: { env: EnvName }) {
  const [q, setQ] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const rows = useMemo(() => {
    return ENV_OVERVIEW_KEYS.map((r) => {
      const status = r.status[env];
      let v: string | null = "";
      if (status === "set") v = r.secret ? "••••••••••••••••••••••••" : sampleValue(r.k, env);
      else if (status === "empty") v = "";
      else v = null;
      return { ...r, v, status };
    }).filter((r) => r.status !== "missing");
  }, [env]);

  const filtered = rows.filter((r) => !q || r.k.toLowerCase().includes(q.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.k)));
  };

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
        <Button variant="outline" size="sm" className="gap-1.5">
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
          3 commits
        </Button>
        <Button size="sm" className="gap-1.5">
          <HugeiconsIcon icon={AddSquareIcon} className="size-3.5" />
          Add secret
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="grid grid-cols-[32px_24px_1fr_2fr_200px] items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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
        {filtered.map((r) => (
          <div
            key={r.k}
            className="group grid grid-cols-[32px_24px_1fr_2fr_200px] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
          >
            <Checkbox
              checked={selected.has(r.k)}
              onCheckedChange={() =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(r.k)) next.delete(r.k);
                  else next.add(r.k);
                  return next;
                })
              }
              aria-label={`Select ${r.k}`}
            />
            <HugeiconsIcon
              icon={Key01Icon}
              className="size-3 text-muted-foreground/70"
            />
            <span className="font-mono text-xs font-medium">{r.k}</span>
            <span className="min-w-0 truncate border-l pl-3">
              {r.v === "" ? (
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60">
                  EMPTY
                </span>
              ) : (
                <span
                  className={cn(
                    "font-mono text-xs",
                    r.secret && !revealAll
                      ? "text-muted-foreground"
                      : "text-foreground/85",
                  )}
                >
                  {r.secret && !revealAll ? "••••••••••••••••••••••••••••" : r.v}
                </span>
              )}
            </span>
            <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <RowAction title="Copy" icon={Copy01Icon} />
              <RowAction title="Tag" icon={FlashIcon} />
              <RowAction title="Pin" icon={Link01Icon} />
              <RowAction title="History" icon={GitBranchIcon} />
              <RowAction title="Reference" icon={Refresh01Icon} />
              <RowAction title="Delete" icon={Cancel01Icon} />
            </span>
          </div>
        ))}

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
          Drag and drop a <code className="font-mono">.env</code>,{" "}
          <code className="font-mono">.json</code>,{" "}
          <code className="font-mono">.csv</code>, or{" "}
          <code className="font-mono">.yml</code> file here.
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">or</div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
          Paste secrets
        </Button>
      </div>

      <BulkEditDialog
        env={env}
        rows={rows}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
      />
    </div>
  );
}

function RowAction({
  title,
  icon,
}: {
  title: string;
  icon: typeof Copy01Icon;
}) {
  return (
    <Button variant="ghost" size="icon" className="size-6" title={title}>
      <HugeiconsIcon icon={icon} className="size-3" />
    </Button>
  );
}

function sampleValue(key: string, env: EnvName) {
  const e = env === "preview" ? "dev" : env === "staging" ? "stg" : "prod";
  const samples: Record<string, string> = {
    DATABASE_URL: `postgres://helio:•••@${e}-postgres:5432/helio`,
    BETTER_AUTH_URL: `https://${e === "prod" ? "" : e + "."}helio.so`,
    CORS_ORIGIN: `https://${e === "prod" ? "" : e + "."}helio.so`,
    VITE_SERVER_URL: `https://api.${e === "prod" ? "" : e + "."}helio.so`,
    BETTER_AUTH_SECRET: "sk_••••••••••••••",
    APPLE_APP_BUNDLE_ID: "com.paperhouse.helio",
  };
  return samples[key] || `${key.toLowerCase()}_value`;
}

// ────── Bulk edit ──────

interface BulkRow {
  k: string;
  v: string | null;
  secret: boolean;
}

interface ParsedVar {
  k: string;
  v: string;
  secret: boolean;
}

function BulkEditDialog({
  env,
  rows,
  open,
  onOpenChange,
}: {
  env: EnvName;
  rows: BulkRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = rows.map((v) => `${v.k}=${v.v ?? ""}`).join("\n");
  const [text, setText] = useState(initial);
  const [target, setTarget] = useState<Set<EnvName>>(new Set([env]));

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
      out.push({ k, v, secret: /SECRET|KEY|TOKEN|PASS|DSN/i.test(k) });
    }
    return out;
  }, [text]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-baseline gap-2 text-sm font-semibold">
            Bulk edit
            <span className="font-mono text-xs font-normal text-muted-foreground capitalize">
              · {env}
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
                Apply to
              </div>
              <div className="flex flex-col gap-1">
                {ENVS.map((e) => (
                  <label key={e} className="flex cursor-pointer items-center gap-2 py-1 text-xs">
                    <Checkbox
                      checked={target.has(e)}
                      onCheckedChange={() =>
                        setTarget((s) => {
                          const next = new Set(s);
                          if (next.has(e)) next.delete(e);
                          else next.add(e);
                          return next;
                        })
                      }
                    />
                    <EnvDot env={e} />
                    <span className="capitalize">{e}</span>
                  </label>
                ))}
              </div>
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
                {parsed.filter((p) => p.secret).length} marked secret
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="min-h-0">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Detected
              </div>
              <div className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/80">
                {parsed.slice(0, 12).map((p) => (
                  <div key={p.k} className="flex gap-1.5 py-0.5">
                    <span className={p.secret ? "text-amber-500" : "text-muted-foreground"}>
                      {p.secret ? "••" : "  "}
                    </span>
                    <span className="truncate">{p.k}</span>
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
            Hot-reload to all replicas in {[...target].join(", ") || "(none selected)"}
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Apply {parsed.length} vars →
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvDot({ env }: { env: EnvName }) {
  const tone =
    env === "production"
      ? "bg-emerald-500"
      : env === "staging"
        ? "bg-amber-500"
        : "bg-blue-500";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}

// ────── Sync integrations ──────

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
                    ? { ...x, connected: true, last: "just now", count: 0, env: "production" }
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
          {p.env && (
            <Stat
              label="target env"
              value={
                <span className="flex items-center gap-1 capitalize">
                  <EnvDot env={p.env} /> {p.env}
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
