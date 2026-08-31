import { useState } from "react";

import {
  Cancel01Icon,
  Key01Icon,
  PlusSignIcon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { DefinitionSection } from "./components/definitions-view";
import type { TableRef } from "./data/queries";
import type { DataStudioController } from "./use-data-studio";

interface TableTab {
  id: string;
  kind: "table";
  title: string;
  table: TableRef;
  preview: boolean;
}

interface QueryTab {
  id: string;
  kind: "query";
  title: string;
  snippetId: string;
  preview: boolean;
}

interface DefinitionTab {
  id: string;
  kind: "definition";
  title: string;
  section: DefinitionSection;
  preview: boolean;
}

export type WorkbenchTab = TableTab | QueryTab | DefinitionTab;

const definitionTitle = {
  indexes: "Indexes",
  constraints: "Constraints",
  enums: "Enums",
} as const;

function currentTab(studio: DataStudioController): WorkbenchTab | null {
  const { table, editor } = studio;
  if (table.mode === "sql") {
    const snippetId = editor.activeSnippetId;
    const snippet = editor.snippets.find((item) => item.id === snippetId);
    return {
      id: `query:${snippetId}`,
      kind: "query",
      title: snippet?.name ?? "Query",
      snippetId,
      preview: false,
    };
  }
  if (table.tableView === "definitions") {
    const section = table.definitionsSection;
    return {
      id: `definition:${section}`,
      kind: "definition",
      title: definitionTitle[section],
      section,
      preview: true,
    };
  }
  if (!table.selected) return null;
  return {
    id: `table:${table.selected.schema}.${table.selected.name}`,
    kind: "table",
    title: table.selected.name,
    table: table.selected,
    preview: true,
  };
}

export function upsertWorkbenchTab(
  tabs: readonly WorkbenchTab[],
  next: WorkbenchTab,
): WorkbenchTab[] {
  const existing = tabs.findIndex((tab) => tab.id === next.id);
  if (existing >= 0) {
    return tabs.map((tab, index) => (index === existing ? { ...next, preview: tab.preview } : tab));
  }
  if (next.preview) {
    const preview = tabs.findIndex((tab) => tab.preview);
    if (preview >= 0) return tabs.map((tab, index) => (index === preview ? next : tab));
  }
  return [...tabs, next];
}

interface TabState {
  sourceKey: string | null;
  tabs: WorkbenchTab[];
  activeId: string | null;
}

export function useWorkbenchTabs(studio: DataStudioController) {
  const current = currentTab(studio);
  const currentKey = current ? `${current.id}:${current.title}` : null;
  const [state, setState] = useState<TabState>({ sourceKey: null, tabs: [], activeId: null });

  // The controller is the source of truth. This guarded render-time correction
  // keeps the tab chrome in the same paint as the table/query it names, without
  // a synchronization effect and its extra render.
  if (current && state.sourceKey !== currentKey) {
    setState({
      sourceKey: currentKey,
      tabs: upsertWorkbenchTab(state.tabs, current),
      activeId: current.id,
    });
  }

  const activate = (tab: WorkbenchTab) => {
    setState((value) => ({ ...value, activeId: tab.id }));
    if (tab.kind === "table") {
      studio.table.openTable(tab.table);
      return;
    }
    if (tab.kind === "definition") {
      studio.table.setMode("table");
      studio.table.setDefinitionsSection(tab.section);
      studio.table.setTableView("definitions");
      return;
    }
    studio.editor.setActiveSnippetId(tab.snippetId);
    studio.table.setMode("sql");
  };

  const close = (id: string) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const remaining = state.tabs.filter((tab) => tab.id !== id);
    if (state.activeId !== id) {
      setState((value) => ({ ...value, tabs: remaining }));
      return;
    }
    const next = remaining[Math.min(index, remaining.length - 1)];
    setState((value) => ({ ...value, tabs: remaining, activeId: next?.id ?? null }));
    if (next) activate(next);
  };

  const pin = (id: string) => {
    setState((value) => ({
      ...value,
      tabs: value.tabs.map((tab) => (tab.id === id ? { ...tab, preview: false } : tab)),
    }));
  };

  const newQuery = () => {
    const snippet = studio.newQuery();
    const next: QueryTab = {
      id: `query:${snippet.id}`,
      kind: "query",
      title: snippet.name,
      snippetId: snippet.id,
      preview: false,
    };
    setState((value) => ({
      sourceKey: `${next.id}:${next.title}`,
      tabs: upsertWorkbenchTab(value.tabs, next),
      activeId: next.id,
    }));
  };

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activate,
    close,
    pin,
    newQuery,
  };
}

export function WorkbenchTabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onPin,
  onNewQuery,
}: {
  tabs: WorkbenchTab[];
  activeId: string | null;
  onActivate: (tab: WorkbenchTab) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onNewQuery: () => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Open data workbench tabs"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/20"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const icon =
          tab.kind === "table" ? Table01Icon : tab.kind === "query" ? SourceCodeIcon : Key01Icon;
        return (
          <div
            key={tab.id}
            className={cn(
              "group relative flex max-w-52 min-w-0 shrink-0 items-center gap-1.5 border-r px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
              active &&
                "bg-card text-foreground after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-primary",
              tab.preview && "italic",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onActivate(tab)}
              onDoubleClick={() => onPin(tab.id)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => onClose(tab.id)}
              className={cn(
                "ml-0.5 grid size-4 shrink-0 place-items-center rounded opacity-0 group-hover:opacity-70 hover:bg-muted",
                active && "opacity-70",
              )}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewQuery}
        className="grid w-9 shrink-0 place-items-center border-r text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        aria-label="New query"
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
      </button>
    </div>
  );
}
