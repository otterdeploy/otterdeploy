import { useState } from "react";
import { toast } from "sonner";

import {
  AddSquareIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  FilterIcon,
  Key01Icon,
  Search01Icon,
  Upload01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { variablesCollection } from "@/features/projects/data/variables";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import { BulkEditDialog } from "./variables-bulk-edit";
import type { EnvironmentRef, EnvVarRow } from "./variables-types";

export function PerEnvTable({
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

  const filtered = rows.filter(
    (r) => !q || r.key.toLowerCase().includes(q.toLowerCase()),
  );

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.key)));
  };

  const toggleKey = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // bulkReplace is an atomic whole-env replace (not row-level), so it stays a
  // direct orpc call; afterwards we invalidate the collection's subset query so
  // the live rows refresh.
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: [
        "projectVariables",
        ...orpc.project.envVar.list.queryKey({
          input: {
            projectId: projectId as never,
            environmentId: env.id as never,
          },
        }),
      ],
    });
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
            Key{" "}
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-50" />
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
            <EnvVarRowItem
              key={r.id}
              row={r}
              revealAll={revealAll}
              selected={selected.has(r.key)}
              onToggle={() => toggleKey(r.key)}
            />
          ))
        )}

        <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <HugeiconsIcon icon={Key01Icon} className="size-3" />
          <span>{filtered.length}</span>
          <div className="flex-1" />
          <span className="font-mono">
            1 – {filtered.length} of {filtered.length}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/10 px-6 py-8 text-center">
        <HugeiconsIcon
          icon={Upload01Icon}
          className="size-5 text-muted-foreground"
        />
        <div className="text-sm text-foreground/80">
          Paste or drag a <code className="font-mono">.env</code> block into bulk
          edit.
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

function EnvVarRowItem({
  row,
  revealAll,
  selected,
  onToggle,
}: {
  row: EnvVarRow;
  revealAll: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="group grid grid-cols-[32px_24px_1fr_2fr_120px] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30">
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${row.key}`}
      />
      <HugeiconsIcon
        icon={Key01Icon}
        className="size-3 text-muted-foreground/70"
      />
      <span className="font-mono text-xs font-medium">{row.key}</span>
      <span className="min-w-0 truncate border-l pl-3">
        {row.value === "" ? (
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60">
            EMPTY
          </span>
        ) : (
          <span
            className={cn(
              "font-mono text-xs",
              row.isSecret && !revealAll
                ? "text-muted-foreground"
                : "text-foreground/85",
            )}
          >
            {row.isSecret && !revealAll
              ? "••••••••••••••••••••••••••••"
              : row.value}
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
            void copyToClipboard(row.value).then((ok) =>
              ok ? toast.success(`Copied ${row.key}`) : toast.error("Couldn't copy"),
            );
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-rose-500 hover:text-rose-500"
          title="Delete"
          onClick={() => {
            const tx = variablesCollection.delete(row.id);
            tx.isPersisted.promise.catch((err: unknown) =>
              toast.error(
                err instanceof Error ? err.message : "Couldn't delete",
              ),
            );
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
        </Button>
      </span>
    </div>
  );
}
