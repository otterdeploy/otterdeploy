import { useState } from "react";

import { ArrowDown01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { orpc, queryClient } from "@/shared/server/orpc";

import { BulkEditDialog } from "./variables-bulk-edit";
import { downloadDotEnvFile, hasFiles, readEnvImport } from "./variables-import";
import { EnvVarRowItem } from "./variables-row-item";
import { DragOverlay, DropHint, VariablesToolbar } from "./variables-table-toolbar";
import type { EnvironmentRef, EnvVarRow } from "./variables-types";

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

  const importFile = async (file: File) => {
    const text = await readEnvImport(file);
    if (text === null) return;
    setImportText(text);
    setBulkOpen(true);
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
      {dragging && <DragOverlay envLabel={env.name || env.slug} />}

      <VariablesToolbar
        q={q}
        onQChange={setQ}
        hasRows={rows.length > 0}
        downloadName={`${projectSlug}-${env.slug}.env`}
        onDownload={() => downloadDotEnvFile(rows, `${projectSlug}-${env.slug}.env`)}
        revealAll={revealAll}
        onToggleReveal={() => setRevealAll((r) => !r)}
        onBulkOpen={() => setBulkOpen(true)}
      />

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

      <DropHint onBulkOpen={() => setBulkOpen(true)} />

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
