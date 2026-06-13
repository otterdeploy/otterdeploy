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
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { format as formatSql } from "sql-formatter";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  Table01Icon,
  SquareArrowExpand01Icon,
  Search01Icon,
  PlayIcon,
  FilterIcon,
  MagicWand01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  ArrowDown01Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { Kbd } from "@/shared/components/ui/kbd";
import { cn } from "@/shared/lib/utils";

import type { PostgresBodyProps } from "../../types";
import type { FkTarget } from "@/shared/components/data-grid/types";

import { FilterPopover } from "./components/filter-popover";
import { ResultsPanel, type ResultView } from "./components/results-panel";
import { SchemaExplorer } from "./components/schema-explorer";
import { SnippetTree } from "./components/snippet-tree";
import { DataSpotlight } from "./components/data-spotlight";
import { SqlEditor, type SqlEditorHandle } from "./components/sql-editor";
import { buildWhere, type Filter, isFilterActive, newFilter } from "./data/filters";
import { browseRowsSql, SQL_RESULT_CAP, type TableRef } from "./data/queries";
import {
  useDatabaseTables,
  useQueryRows,
  useTableColumnMeta,
} from "./data/use-database";
import { PLAYGROUND_ID, useSqlSnippets } from "./data/use-sql-snippets";

interface DataTabBodyProps {
  resource: PostgresBodyProps["resource"];
}

const PAGE_SIZES = [50, 100, 200, 500];

export function DataTabBody({ resource }: DataTabBodyProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <DbIdentity resource={resource} />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setExpanded(true)}
        >
          <HugeiconsIcon
            icon={SquareArrowExpand01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
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
        <DialogContent className="left-0 top-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <DbIdentity resource={resource} />
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-4">
            <DataStudio
              resource={resource}
              boxClassName="min-h-0 h-full"
              shortcuts={expanded}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DbIdentity({ resource }: { resource: DataTabBodyProps["resource"] }) {
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
        READ-ONLY
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
  const resourceId = resource.resourceId as never;

  const [mode, setMode] = useState<"table" | "sql">("table");
  const [tableSearch, setTableSearch] = useState("");
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [ranSql, setRanSql] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>("grid");
  const [activeSnippetId, setActiveSnippetId] = useState<string>(PLAYGROUND_ID);
  const [showLeft, setShowLeft] = useState(true);
  // The schema explorer is opt-in — closed until toggled from the toolbar.
  const [showRight, setShowRight] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  const editorRef = useRef<SqlEditorHandle>(null);
  const autoOpenedRef = useRef(false);

  const snippetStore = useSqlSnippets(String(resourceId));
  const {
    folders,
    snippets,
    playground,
    setPlayground,
    addFolder,
    renameFolder,
    deleteFolder,
    addSnippet,
    updateSnippet,
    deleteSnippet,
  } = snippetStore;

  // Resolve the editor buffer from the active snippet; fall back to Playground
  // if the snippet was deleted out from under us.
  const activeSnippet =
    activeSnippetId === PLAYGROUND_ID
      ? null
      : snippets.find((s) => s.id === activeSnippetId);
  useEffect(() => {
    if (activeSnippetId !== PLAYGROUND_ID && !activeSnippet) {
      setActiveSnippetId(PLAYGROUND_ID);
    }
  }, [activeSnippetId, activeSnippet]);
  const editorValue =
    activeSnippetId === PLAYGROUND_ID ? playground : (activeSnippet?.sql ?? "");

  const onEditorChange = (v: string) => {
    if (activeSnippetId === PLAYGROUND_ID) setPlayground(v);
    else updateSnippet(activeSnippetId, { sql: v });
  };

  // ── Data ─────────────────────────────────────────────────────────────
  const tablesQuery = useDatabaseTables(String(resourceId));
  const tables = tablesQuery.data?.tables ?? [];
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) =>
      `${t.schema}.${t.name}`.toLowerCase().includes(q),
    );
  }, [tables, tableSearch]);

  const where = buildWhere(filters);
  const tableSql = selected
    ? browseRowsSql(selected, where, pageSize + 1, page * pageSize)
    : "";
  const activeSql = mode === "table" ? tableSql : (ranSql ?? "");

  const rowsQuery = useQueryRows({
    resourceId: String(resourceId),
    sql: activeSql,
    limit: mode === "table" ? pageSize : SQL_RESULT_CAP,
    enabled: mode === "table" ? Boolean(selected) : Boolean(ranSql),
    keepPrevious: mode === "table",
  });
  const result = rowsQuery.data;
  const hasNext = mode === "table" && (result?.truncated ?? false);

  // Cell variants + FK targets for the open table (table-browse mode only).
  const { columnVariants, columnFks } = useTableColumnMeta({
    resourceId: String(resourceId),
    table: selected,
    enabled: mode === "table",
  });

  // Jump to a referenced table, pre-filtered to the row (from a FK popover).
  function openRefTable(fk: FkTarget, value: string) {
    const target = tables.find(
      (t) => t.schema === fk.schema && t.name === fk.table,
    );
    if (!target) return;
    setSelected(target);
    setMode("table");
    setPage(0);
    setFilters([{ ...newFilter(), column: fk.column, op: "eq", value }]);
  }

  // Autocomplete schema: every table name, plus columns of the open table.
  const schema = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const t of tables) m[t.name] = [];
    if (selected) {
      const cols = Object.keys(columnVariants);
      if (cols.length) m[selected.name] = cols;
    }
    return m;
  }, [tables, selected, columnVariants]);

  // ── Actions ──────────────────────────────────────────────────────────
  const runSql = (sqlText: string) => {
    const trimmed = sqlText.trim();
    if (!trimmed) return;
    setMode("sql");
    if (trimmed === ranSql) void rowsQuery.refetch();
    else setRanSql(trimmed);
  };

  const openTable = (t: TableRef) => {
    setSelected(t);
    setMode("table");
    setPage(0);
    setFilters([]);
  };
  // Switch back to the (primary) table-browse view from the SQL playground.
  const backToTable = () => {
    if (!selected && tables.length > 0) openTable(tables[0] as TableRef);
    else setMode("table");
  };
  const changeFilters = (next: Filter[]) => {
    setFilters(next);
    setPage(0);
  };

  // Land on the first table's rows once the list loads (browse, not authored
  // SQL). Fires once so it never fights a manual SQL/snippet switch afterward.
  useEffect(() => {
    if (!autoOpenedRef.current && !selected && tables[0]) {
      autoOpenedRef.current = true;
      openTable(tables[0]);
    }
  }, [tables, selected]);

  const prettify = () => {
    try {
      onEditorChange(
        formatSql(editorValue, {
          language: "postgresql",
          keywordCase: "upper",
        }),
      );
    } catch {
      /* leave the buffer untouched on parse error */
    }
  };

  const selectSnippet = (id: string) => {
    setActiveSnippetId(id);
    setMode("sql");
  };
  const newQuery = () => {
    const s = addSnippet({ name: "Untitled query", sql: "" });
    selectSnippet(s.id);
  };

  const openInSql = () => {
    if (!selected) return;
    const q = `SELECT * FROM "${selected.schema}"."${selected.name}"${where} LIMIT ${pageSize};`;
    const s = addSnippet({
      name: `${selected.name} query`,
      sql: q,
      folderId: null,
    });
    selectSnippet(s.id);
    runSql(q);
  };

  // ⌘K — only the visible studio listens (`enabled` is synced every render).
  useHotkey(
    "Mod+K",
    (event) => {
      event.preventDefault();
      setSpotlightOpen((o) => !o);
    },
    { enabled: shortcuts },
  );

  const activeFilterCount = filters.filter(isFilterActive).length;
  const resultColumns = result?.columns ?? [];
  const editorEmpty = editorValue.trim().length === 0;

  // The results pane is identical in both modes — only the surrounding chrome
  // differs (Table mode: tables sidebar; SQL mode: snippets + editor). Defined
  // once and rendered in whichever layout `mode` selects.
  const resultsPanel = (
    <ResultsPanel
      resourceId={resourceId}
      columns={resultColumns}
      rows={result?.rows ?? []}
      columnVariants={mode === "table" ? columnVariants : undefined}
      columnFks={mode === "table" ? columnFks : undefined}
      onOpenRef={openRefTable}
      view={view}
      onViewChange={setView}
      isLoading={rowsQuery.isLoading}
      isError={rowsQuery.isError}
      errorMessage={errMessage(rowsQuery.error)}
      hasResult={Boolean(result)}
      exportName={mode === "table" && selected ? selected.name : "query"}
      emptyIcon={mode === "sql" ? PlayIcon : Database01Icon}
      emptyTitle={mode === "sql" ? "Run a query" : "Select a table"}
      emptyBody={
        mode === "sql"
          ? "Write read-only SQL above, then run a statement with its ▶ or ⌘↵."
          : "Pick a table from the left to browse its rows."
      }
      leftSlot={
        mode === "table" && selected ? (
          <>
            <FilterPopover
              columns={resultColumns}
              filters={filters}
              onApply={changeFilters}
              trigger={
                <Button
                  variant={activeFilterCount ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 gap-1.5"
                >
                  <HugeiconsIcon
                    icon={FilterIcon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                  Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6"
              onClick={openInSql}
            >
              Open in SQL
            </Button>
          </>
        ) : null
      }
      footerSlot={
        result ? (
          <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2 font-mono">
              <span>{result.rows.length} rows</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{result.durationMs}ms</span>
              {mode === "sql" && result.truncated ? (
                <span className="text-amber-500">· capped at {SQL_RESULT_CAP}</span>
              ) : null}
            </div>
            {mode === "table" ? (
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {result.rows.length === 0
                    ? "0"
                    : `${page * pageSize + 1}–${page * pageSize + result.rows.length}`}
                </span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-6 w-19 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}/page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  ‹
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  ›
                </Button>
              </div>
            ) : null}
          </div>
        ) : null
      }
    />
  );

  // Table list — shared by the Table-mode left sidebar and the SQL-mode right rail.
  const tableList = tablesQuery.isLoading ? (
    <SidebarSkeleton />
  ) : tablesQuery.isError ? (
    <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
      {errMessage(tablesQuery.error)}
    </p>
  ) : filteredTables.length === 0 ? (
    <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
      {tables.length ? "No matches." : "No tables yet."}
    </p>
  ) : (
    <div className="flex flex-col gap-0.5">
      {filteredTables.map((tbl) => {
        const active =
          selected?.schema === tbl.schema && selected?.name === tbl.name;
        return (
          <button
            key={`${tbl.schema}.${tbl.name}`}
            type="button"
            onClick={() => openTable(tbl)}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={Table01Icon}
              strokeWidth={2}
              className="size-3.5 shrink-0"
            />
            <span className="truncate" title={`${tbl.schema}.${tbl.name}`}>
              {tbl.schema === "public" ? tbl.name : `${tbl.schema}.${tbl.name}`}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-lg border bg-card",
        boxClassName,
      )}
    >
      {mode === "table" ? (
        /* ── Table browser — the primary view ─────────────────────────── */
        <div className="flex h-full min-h-0 w-full">
          {/* Left rail — tables + a way into the SQL console */}
          <div className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
            <div className="space-y-2 p-2">
              <div className="relative">
                <HugeiconsIcon
                  icon={Search01Icon}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search tables…"
                  className="h-7 pl-7 text-[12px]"
                />
              </div>
              <button
                type="button"
                onClick={() => setMode("sql")}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={SourceCodeIcon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0"
                />
                SQL console
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <div className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Tables {tables.length ? `· ${tables.length}` : ""}
              </div>
              {tableList}
            </div>
          </div>
          {/* Main — filters + grid + pagination */}
          <div className="flex min-w-0 flex-1 flex-col">{resultsPanel}</div>
        </div>
      ) : (
        /* ── SQL playground — the secondary view ──────────────────────── */
        <ResizablePanelGroup orientation="horizontal">
          {/* Left rail — snippets */}
          {showLeft ? (
            <>
              <ResizablePanel id="left" defaultSize={20} minSize={12}>
                <div className="flex h-full min-h-0 flex-col border-r bg-muted/20">
                  <SnippetTree
                    folders={folders}
                    snippets={snippets}
                    activeId={activeSnippetId}
                    onBackToTable={backToTable}
                    onSelect={selectSnippet}
                    addFolder={addFolder}
                    renameFolder={renameFolder}
                    deleteFolder={deleteFolder}
                    addSnippet={addSnippet}
                    renameSnippet={(id, name) => updateSnippet(id, { name })}
                    deleteSnippet={deleteSnippet}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          ) : null}

          {/* Center — toolbar + editor / results */}
          <ResizablePanel id="center" defaultSize={58} minSize={30}>
            <div className="flex h-full min-w-0 flex-col">
              {/* Toolbar */}
              <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-2">
                {/* Left — run + edit actions */}
                <div className="flex items-center gap-1">
                  <div className="flex items-center">
                    <Button
                      size="sm"
                      className="gap-1.5 rounded-r-none"
                      disabled={rowsQuery.isFetching || editorEmpty}
                      onClick={() => editorRef.current?.runCurrent()}
                    >
                      <HugeiconsIcon
                        icon={PlayIcon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                      Run
                      <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                        ⌘↵
                      </span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                          disabled={editorEmpty}
                          aria-label="Run options"
                        >
                          <HugeiconsIcon
                            icon={ArrowDown01Icon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onSelect={() => editorRef.current?.runCurrent()}
                        >
                          Run current statement
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => editorRef.current?.runSelection()}
                        >
                          Run selection
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => editorRef.current?.runAll()}
                        >
                          Run all statements
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <Separator orientation="vertical" className="mx-1 h-4" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={editorEmpty}
                    onClick={prettify}
                  >
                    <HugeiconsIcon
                      icon={MagicWand01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                    Prettify
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setShowLeft((v) => !v)}
                        aria-label="Toggle snippets panel"
                      >
                        <HugeiconsIcon
                          icon={SidebarLeft01Icon}
                          strokeWidth={2}
                          className="size-3.5"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Snippets</TooltipContent>
                  </Tooltip>
                </div>

                {/* Right — schema explorer toggle (labeled, far right) */}
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </span>
                  <Button
                    variant={showRight ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowRight((v) => !v)}
                  >
                    <HugeiconsIcon
                      icon={SidebarRight01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                    Columns
                  </Button>
                </div>
              </div>

              {/* Editor over results — this whole layout is the SQL playground. */}
              <ResizablePanelGroup
                orientation="vertical"
                className="min-h-0 flex-1"
              >
                <ResizablePanel id="editor" defaultSize={42} minSize={15}>
                  <div className="h-full min-h-0 overflow-hidden">
                    <SqlEditor
                      ref={editorRef}
                      value={editorValue}
                      onChange={onEditorChange}
                      schema={schema}
                      onRun={runSql}
                    />
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="results" defaultSize={58} minSize={15}>
                  {resultsPanel}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>

          {/* Right rail — schema explorer (collapsible tables → columns) */}
          {showRight ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel id="right" defaultSize={22} minSize={12}>
                <div className="flex h-full min-h-0 flex-col border-l bg-muted/20">
                  <div className="p-2">
                    <div className="relative">
                      <HugeiconsIcon
                        icon={Search01Icon}
                        strokeWidth={2}
                        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                        placeholder="Search tables…"
                        className="h-7 pl-7 text-[12px]"
                      />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <div className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Tables {tables.length ? `· ${tables.length}` : ""}
                    </div>
                    <SchemaExplorer
                      resourceId={String(resourceId)}
                      tables={filteredTables}
                      isLoading={tablesQuery.isLoading}
                      isError={tablesQuery.isError}
                      errorMessage={errMessage(tablesQuery.error)}
                      hasTables={tables.length > 0}
                    />
                  </div>
                </div>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      )}

      <DataSpotlight
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
        tables={tables}
        snippets={snippets}
        onOpenTable={openTable}
        onOpenSnippet={selectSnippet}
        onRunCurrent={() => editorRef.current?.runCurrent()}
        onRunAll={() => editorRef.current?.runAll()}
        onPrettify={prettify}
        onNewQuery={newQuery}
        onToggleLeft={() => setShowLeft((v) => !v)}
        onToggleRight={() => setShowRight((v) => !v)}
      />
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

/** Pull the human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to the message. */
function errMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}
