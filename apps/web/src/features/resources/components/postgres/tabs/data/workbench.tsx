/**
 * The workbench itself: table browser or SQL playground over one target.
 *
 * Extracted from the Data tab when the workbench got its own route. It is the
 * ONE implementation both doors render — `/$orgSlug/data` and (until it became
 * a link) the resource panel — so the two cannot drift into two viewers, which
 * is the whole failure this rebuild started from.
 *
 * It takes a `WorkbenchTarget`, never a resource: half of what it can open is
 * an external connection with no resource behind it.
 */
import { useRef } from "react";

import { cn } from "@/shared/lib/utils";

import type { SqlEditorHandle } from "./components/sql-editor";
import type { WorkbenchTarget } from "./data/target";
import type { WorkbenchUrlState } from "./data/url-state";

import { DataSpotlight } from "./components/data-spotlight";
import { RailContent } from "./components/workbench-rail";
import { WorkbenchTabs } from "./components/workbench-tabs";
import { StudioResults } from "./studio-results";
import { SqlPlaygroundView } from "./studio-sql-view";
import { TableBrowserView } from "./studio-table-view";
import { useDataStudio } from "./use-data-studio";
import { WriteConfirmDialog } from "./write-confirm-dialog";

export function DataWorkbench({
  target,
  label,
  className,
  shortcuts = true,
  urlInit,
  onUrlState,
}: {
  target: WorkbenchTarget;
  /** Human name of the database, for the destructive-write confirm gate. */
  label: string;
  className?: string;
  /** False while another workbench above this one owns ⌘K. */
  shortcuts?: boolean;
  /** Browse state decoded from the URL; the route owns the round trip. */
  urlInit?: WorkbenchUrlState;
  onUrlState?: (state: WorkbenchUrlState) => void;
}) {
  const studio = useDataStudio(target, shortcuts, { init: urlInit, onUrlState });
  // The editor handle is held here (not on the controller) so the shared
  // `studio` object never carries a ref. See use-data-studio.ts.
  const editorRef = useRef<SqlEditorHandle>(null);
  // The results pane is identical in both modes. Built once and rendered in
  // whichever layout `mode` selects.
  const results = <StudioResults studio={studio} />;

  return (
    <div className={cn("flex overflow-hidden bg-background", className)}>
      {/* ONE rail, owned here rather than by either mode's layout. When each
          layout carried its own (fixed-width here, percentage panel there),
          switching tabs visibly resized the sidebar — the same element must
          survive the mode change untouched. */}
      <div className="hidden w-60 shrink-0 flex-col border-r sm:flex">
        <RailContent studio={studio} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <WorkbenchTabs studio={studio} />
        {studio.table.mode === "table" ? (
          <TableBrowserView studio={studio} results={results} />
        ) : (
          <SqlPlaygroundView studio={studio} results={results} editorRef={editorRef} />
        )}
      </div>

      <WriteConfirmDialog studio={studio} databaseName={label} />

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
