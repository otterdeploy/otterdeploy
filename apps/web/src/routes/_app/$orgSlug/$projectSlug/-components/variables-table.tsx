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
import { serializeDotEnv } from "./variables-dotenv";
import type { EnvironmentRef, EnvVarRow } from "./variables-types";

/** Drag-drop .env imports above this size are refused with an honest toast. */
const MAX_IMPORT_BYTES = 512 * 1024;

function isEnvLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".env") ||
    name.endsWith(".txt") ||
    name.startsWith(".env") || // .env, .env.local, .env.production…
    file.type === "text/plain"
  );
}

/** True when the drag payload contains OS files (not in-page drags). */
function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}

export function PerEnvTable({
  projectId,
  projectSlug,
  env,
  allEnvs,
  rows,
}: {
  projectId: string;
  projectSlug: string;
  env: EnvironmentRef;
  allEnvs: EnvironmentRef[];
  rows: EnvVarRow[];
}) {
  const [q, setQ] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Text a dropped .env file seeds the bulk-edit dialog with.
  const [importText, setImportText] = useState<string | null>(null);
  // Depth counter — dragenter/dragleave fire per child, so a plain
  // boolean flickers while dragging across the table.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

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
  // direct orpc call; afterwards we invalidate the collection's subset query
  // for every env that was written so the live rows refresh.
  const invalidate = (envIds: string[]) => {
    for (const envId of envIds) {
      void queryClient.invalidateQueries({
        queryKey: [
          "projectVariables",
          ...orpc.project.envVar.list.queryKey({
            input: {
              projectId: projectId as never,
              environmentId: envId as never,
            },
          }),
        ],
      });
    }
  };

  // Explicit export: always writes real values regardless of the masked
  // state — the reveal toggle only affects on-screen rendering.
  const downloadDotEnv = () => {
    const content = serializeDotEnv(
      rows.map((r) => ({ key: r.key, value: r.value })),
    );
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectSlug}-${env.slug}.env`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    if (!isEnvLikeFile(file)) {
      toast.error(`Can't import ${file.name} — drop a .env or .txt file.`);
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(
        `${file.name} is ${Math.ceil(file.size / 1024)} KB — imports are capped at ${MAX_IMPORT_BYTES / 1024} KB.`,
      );
      return;
    }
    try {
      const text = await file.text();
      setImportText(text);
      setBulkOpen(true);
    } catch {
      toast.error(`Couldn't read ${file.name}.`);
    }
  };

  return (
    <div
      className="relative mx-auto w-full max-w-6xl p-6"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragDepth(0);
        const file = e.dataTransfer.files[0];
        if (file) void importFile(file);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-md bg-background/85 ring-2 ring-inset ring-primary/60">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <HugeiconsIcon icon={Upload01Icon} className="size-5 text-primary" />
            <div className="text-sm font-medium">
              Drop <code className="font-mono">.env</code> to import into{" "}
              <span className="capitalize">{env.name || env.slug}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Opens bulk edit for review — nothing is saved until you apply.
            </div>
          </div>
        </div>
      )}

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
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Download .env"
          title={
            rows.length === 0
              ? "No variables to download"
              : `Download ${projectSlug}-${env.slug}.env`
          }
          disabled={rows.length === 0}
          onClick={downloadDotEnv}
        >
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
          Drag a <code className="font-mono">.env</code> file anywhere on this
          tab, or paste into bulk edit.
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
          Open bulk edit
        </Button>
      </div>

      <BulkEditDialog
        projectId={projectId}
        env={env}
        allEnvs={allEnvs}
        currentRows={rows}
        open={bulkOpen}
        onOpenChange={(o) => {
          setBulkOpen(o);
          if (!o) setImportText(null);
        }}
        onSaved={invalidate}
        prefillText={importText}
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
