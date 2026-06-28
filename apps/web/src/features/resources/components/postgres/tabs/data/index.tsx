/**
 * "Data" tab — the built-in database console (read-only v1).
 *
 * A studio-style layout: a left rail of browser-stored SQL snippets, a center
 * pane with a CodeMirror editor (per-statement run gutter, ⌘↵, Prettify) over a
 * results panel (grid / JSON / CSV export), and a right rail listing the
 * database's tables. Clicking a table browses it (server-side ORDER BY +
 * filters + LIMIT/OFFSET pagination); the editor runs arbitrary read-only SQL.
 * Nothing auto-runs — execution is always an explicit ▶, ⌘↵, or Run. ⌘K opens a
 * scoped spotlight. Writes are a later phase — see docs/designs/data-viewer.md.
 *
 * The studio's state + actions live in {@link useDataStudio}; the three layout
 * views live in the sibling `studio-*` modules.
 */

import { useRef, useState } from "react";

import { Database01Icon, SquareArrowExpand01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";

import type { PostgresBodyProps } from "../../types";
import type { SqlEditorHandle } from "./components/sql-editor";

import { DataSpotlight } from "./components/data-spotlight";
import { useDataCapabilities } from "./data/use-database";
import { StudioResults } from "./studio-results";
import { SqlPlaygroundView } from "./studio-sql-view";
import { TableBrowserView } from "./studio-table-view";
import { useDataStudio } from "./use-data-studio";

interface DataTabBodyProps {
  resource: PostgresBodyProps["resource"];
}

export function DataTabBody({ resource }: DataTabBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const canWrite = useDataCapabilities(String(resource.resourceId)).data?.canWrite ?? false;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <DbIdentity resource={resource} canWrite={canWrite} />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExpanded(true)}>
          <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} className="size-3.5" />
          Open editor
        </Button>
      </div>

      {/* Inline studio listens for ⌘K only while the fullscreen one is closed. */}
      <DataStudio
        resource={resource}
        boxClassName="h-[calc(100dvh-20rem)] min-h-[460px]"
        shortcuts={!expanded}
      />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <DbIdentity resource={resource} canWrite={canWrite} />
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-4">
            <DataStudio resource={resource} boxClassName="min-h-0 h-full" shortcuts={expanded} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DbIdentity({
  resource,
  canWrite,
}: {
  resource: DataTabBodyProps["resource"];
  canWrite: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <HugeiconsIcon
        icon={Database01Icon}
        strokeWidth={2}
        className="size-4 text-muted-foreground"
      />
      <span className="font-mono">{resource.databaseName}</span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-muted-foreground">{resource.engine}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">
        {canWrite ? "EDITABLE" : "READ-ONLY"}
      </span>
    </div>
  );
}

function DataStudio({
  resource,
  boxClassName,
  shortcuts,
}: {
  resource: DataTabBodyProps["resource"];
  boxClassName?: string;
  shortcuts: boolean;
}) {
  const studio = useDataStudio(resource, shortcuts);
  // The editor handle is held here (not on the controller) so the shared
  // `studio` object never carries a ref — see use-data-studio.ts.
  const editorRef = useRef<SqlEditorHandle>(null);
  // The results pane is identical in both modes — built once and rendered in
  // whichever layout `mode` selects.
  const results = <StudioResults studio={studio} />;

  return (
    <div className={cn("flex overflow-hidden rounded-lg border bg-card", boxClassName)}>
      {studio.table.mode === "table" ? (
        <TableBrowserView studio={studio} results={results} />
      ) : (
        <SqlPlaygroundView studio={studio} results={results} editorRef={editorRef} />
      )}

      <DataSpotlight
        open={studio.spotlightOpen}
        onOpenChange={studio.setSpotlightOpen}
        tables={studio.table.tables}
        snippets={studio.editor.snippets}
        onOpenTable={studio.table.openTable}
        onOpenSnippet={studio.selectSnippet}
        onRunCurrent={() => editorRef.current?.runCurrent()}
        onRunAll={() => editorRef.current?.runAll()}
        onPrettify={studio.editor.prettify}
        onNewQuery={studio.newQuery}
        onToggleLeft={() => studio.setShowLeft((v) => !v)}
        onToggleRight={() => studio.setShowRight((v) => !v)}
      />
    </div>
  );
}
