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
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { SourceCodeIcon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { cn } from "@/shared/lib/utils";

import type { SqlEditorHandle } from "./components/sql-editor";
import type { WorkbenchTarget } from "./data/target";
import type { DataStudioController } from "./use-data-studio";

import { DataSpotlight } from "./components/data-spotlight";
import { StudioResults } from "./studio-results";
import { SqlPlaygroundView } from "./studio-sql-view";
import { useDataStudio } from "./use-data-studio";
import { WorkbenchRail } from "./workbench-rail";
import { useWorkbenchTabs, WorkbenchTabBar } from "./workbench-tabs";
import { WriteConfirmDialog } from "./write-confirm-dialog";

export function DataWorkbench({
  target,
  label,
  connection,
  className,
  shortcuts = true,
}: {
  target: WorkbenchTarget;
  /** Human name of the database, for the destructive-write confirm gate. */
  label: string;
  /** The managed/external connection switcher, anchored inside the rail. */
  connection: ReactNode;
  className?: string;
  /** False while another workbench above this one owns ⌘K. */
  shortcuts?: boolean;
}) {
  const studio = useDataStudio(target, shortcuts);
  const tabs = useWorkbenchTabs(studio);
  // The editor handle is held here (not on the controller) so the shared
  // `studio` object never carries a ref. See use-data-studio.ts.
  const editorRef = useRef<SqlEditorHandle>(null);
  // The results pane is identical in both modes. Built once and rendered in
  // whichever layout `mode` selects.
  const results = <StudioResults studio={studio} />;

  return (
    <div className={cn("flex min-h-0 overflow-hidden border-y bg-card", className)}>
      <WorkbenchRail
        studio={studio}
        connection={connection}
        onOpenTable={studio.table.openTable}
        onOpenDefinition={(section) => {
          studio.table.setMode("table");
          studio.table.setDefinitionsSection(section);
          studio.table.setTableView("definitions");
        }}
        onNewQuery={tabs.newQuery}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-b p-1.5 md:hidden">
          <div className="min-w-0 flex-1">{connection}</div>
          <MobileWorkbenchRail studio={studio} connection={connection} onNewQuery={tabs.newQuery} />
        </div>
        <WorkbenchTabBar
          tabs={tabs.tabs}
          activeId={tabs.activeId}
          onActivate={tabs.activate}
          onClose={tabs.close}
          onPin={tabs.pin}
          onNewQuery={tabs.newQuery}
        />

        {tabs.activeId === null ? (
          <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
            <div>
              <HugeiconsIcon
                icon={SourceCodeIcon}
                strokeWidth={1.5}
                className="mx-auto mb-3 size-8 text-muted-foreground/50"
              />
              <p className="text-sm font-medium">No tab open</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a table from the rail or start a query.
              </p>
              <Button size="sm" className="mt-4" onClick={tabs.newQuery}>
                New query
              </Button>
            </div>
          </div>
        ) : studio.table.mode === "table" ? (
          results
        ) : (
          <SqlPlaygroundView studio={studio} results={results} editorRef={editorRef} />
        )}
      </main>

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

function MobileWorkbenchRail({
  studio,
  connection,
  onNewQuery,
}: {
  studio: DataStudioController;
  connection: ReactNode;
  onNewQuery: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Browse database objects"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-4" />
      </Button>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Database objects</SheetTitle>
          <SheetDescription>Pick a table or database definition to open.</SheetDescription>
        </SheetHeader>
        <WorkbenchRail
          studio={studio}
          connection={connection}
          onOpenTable={(table) => {
            studio.table.openTable(table);
            close();
          }}
          onOpenDefinition={(section) => {
            studio.table.setMode("table");
            studio.table.setDefinitionsSection(section);
            studio.table.setTableView("definitions");
            close();
          }}
          onNewQuery={() => {
            onNewQuery();
            close();
          }}
          className="flex h-full w-full border-r-0"
        />
      </SheetContent>
    </Sheet>
  );
}
