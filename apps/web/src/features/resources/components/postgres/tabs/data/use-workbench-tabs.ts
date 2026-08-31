/**
 * The workbench's tab strip: every table and query you have open, in the order
 * you opened them.
 *
 * The ACTIVE tab is derived from the studio's real state — the mode, the open
 * table, the active snippet — and never stored. Two sources of truth for "what
 * is open" is how a tab bar and a results pane end up disagreeing, and every
 * existing way of opening something (rail click, FK jump, spotlight, auto-open)
 * keeps working without knowing tabs exist: whatever becomes active earns its
 * tab on the next render.
 *
 * Only the LIST is state, because only the list carries memory: which things
 * were opened and not yet closed.
 */
import { useState } from "react";

import type { TableRef } from "./data/queries";

import { PLAYGROUND_ID } from "./data/use-sql-snippets";

export type WorkbenchTab =
  | { kind: "table"; schema: string; name: string }
  | { kind: "query"; snippetId: string };

export function workbenchTabId(tab: WorkbenchTab): string {
  return tab.kind === "table" ? `t:${tab.schema}.${tab.name}` : `q:${tab.snippetId}`;
}

interface TabDeps {
  mode: "table" | "sql";
  selected: TableRef | null;
  activeSnippetId: string;
  snippetIds: readonly string[];
  openTable: (table: TableRef) => void;
  selectSnippet: (id: string) => void;
}

export function useWorkbenchTabs(deps: TabDeps) {
  const [list, setList] = useState<WorkbenchTab[]>([]);

  const active: WorkbenchTab | null =
    deps.mode === "table"
      ? deps.selected && {
          kind: "table",
          schema: deps.selected.schema,
          name: deps.selected.name,
        }
      : { kind: "query", snippetId: deps.activeSnippetId };
  const activeId = active === null ? null : workbenchTabId(active);

  // Render-phase reconcile (the compare-with-previous pattern, not an effect):
  // the active thing earns a tab if it lacks one, and a tab whose snippet was
  // deleted out from under it drops off.
  const known = new Set(deps.snippetIds);
  const next = list.filter(
    (t) => t.kind === "table" || t.snippetId === PLAYGROUND_ID || known.has(t.snippetId),
  );
  if (active !== null && !next.some((t) => workbenchTabId(t) === activeId)) next.push(active);
  const signature = (tabs: WorkbenchTab[]) => tabs.map(workbenchTabId).join("|");
  if (signature(next) !== signature(list)) setList(next);

  const activate = (tab: WorkbenchTab) => {
    if (tab.kind === "table") deps.openTable({ schema: tab.schema, name: tab.name });
    else deps.selectSnippet(tab.snippetId);
  };

  const close = (id: string) => {
    const idx = list.findIndex((t) => workbenchTabId(t) === id);
    if (idx === -1) return;
    const remaining = list.filter((_, i) => i !== idx);
    setList(remaining);
    if (id !== activeId) return;
    // Land on the nearest neighbour, the way every editor does. Closing the
    // LAST tab leaves the underlying state alone, so the reconcile above will
    // re-add it — which reads as "the last tab does not close", honestly.
    const neighbour = remaining[Math.min(idx, remaining.length - 1)];
    if (neighbour) activate(neighbour);
  };

  return { list, activeId, activate, close };
}

export type WorkbenchTabsController = ReturnType<typeof useWorkbenchTabs>;
