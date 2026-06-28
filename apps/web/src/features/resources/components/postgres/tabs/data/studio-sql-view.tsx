/**
 * The SQL-playground layout for the Data studio — a resizable three-pane shell
 * (snippets rail · editor-over-results center · schema-explorer rail). The
 * toolbar lives in {@link ./studio-sql-toolbar}. Driven by the
 * {@link DataStudioController}; the editor handle is passed in separately.
 */

import type { ReactNode, RefObject } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";

import { SchemaExplorer } from "./components/schema-explorer";
import { SnippetTree } from "./components/snippet-tree";
import { SqlEditor, type SqlEditorHandle } from "./components/sql-editor";
import { SqlToolbar } from "./studio-sql-toolbar";
import { type DataStudioController, errMessage } from "./use-data-studio";

export function SqlPlaygroundView({
  studio,
  results,
  editorRef,
}: {
  studio: DataStudioController;
  results: ReactNode;
  editorRef: RefObject<SqlEditorHandle | null>;
}) {
  const { table: t, editor } = studio;
  return (
    <ResizablePanelGroup orientation="horizontal">
      {/* Left rail — snippets */}
      {studio.showLeft ? (
        <>
          <ResizablePanel id="left" defaultSize={20} minSize={12}>
            <div className="flex h-full min-h-0 flex-col border-r bg-muted/20">
              <SnippetTree
                folders={editor.folders}
                snippets={editor.snippets}
                activeId={editor.activeSnippetId}
                onBackToTable={t.backToTable}
                onSelect={studio.selectSnippet}
                addFolder={editor.addFolder}
                renameFolder={editor.renameFolder}
                deleteFolder={editor.deleteFolder}
                addSnippet={editor.addSnippet}
                renameSnippet={(id, name) => editor.updateSnippet(id, { name })}
                deleteSnippet={editor.deleteSnippet}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      ) : null}

      {/* Center — toolbar + editor / results */}
      <ResizablePanel id="center" defaultSize={58} minSize={30}>
        <div className="flex h-full min-w-0 flex-col">
          <SqlToolbar studio={studio} editorRef={editorRef} />
          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel id="editor" defaultSize={42} minSize={15}>
              <div className="h-full min-h-0 overflow-hidden">
                <SqlEditor
                  ref={editorRef}
                  value={editor.editorValue}
                  onChange={editor.onEditorChange}
                  schema={t.schema}
                  onRun={t.runSql}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="results" defaultSize={58} minSize={15}>
              {results}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>

      {/* Right rail — schema explorer (collapsible tables → columns) */}
      {studio.showRight ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="right" defaultSize={22} minSize={12}>
            <SchemaExplorerRail studio={studio} />
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

function SchemaExplorerRail({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-muted/20">
      <div className="p-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={t.tableSearch}
            onChange={(e) => t.setTableSearch(e.target.value)}
            placeholder="Search tables…"
            className="h-7 pl-7 text-[12px]"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="px-1.5 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Tables {t.tables.length ? `· ${t.tables.length}` : ""}
        </div>
        <SchemaExplorer
          resourceId={String(t.resourceId)}
          tables={t.filteredTables}
          isLoading={t.tablesQuery.isLoading}
          isError={t.tablesQuery.isError}
          errorMessage={errMessage(t.tablesQuery.error)}
          hasTables={t.tables.length > 0}
        />
      </div>
    </div>
  );
}
