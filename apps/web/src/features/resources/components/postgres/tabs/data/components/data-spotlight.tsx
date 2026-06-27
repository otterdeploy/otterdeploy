import {
  File01Icon,
  MagicWand01Icon,
  PlayIcon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
/**
 * ⌘K spotlight for the data console — a scoped command menu (not the global
 * palette). Jump to a table, run the current/all statements, prettify, create
 * a query, open a saved snippet, or toggle the side rails.
 */
import { HugeiconsIcon } from "@hugeicons/react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/shared/components/ui/command";

import type { SqlSnippet } from "../data/use-sql-snippets";

interface DataSpotlightProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: { schema: string; name: string }[];
  snippets: SqlSnippet[];
  onOpenTable: (t: { schema: string; name: string }) => void;
  onOpenSnippet: (id: string) => void;
  onRunCurrent: () => void;
  onRunAll: () => void;
  onPrettify: () => void;
  onNewQuery: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function DataSpotlight({
  open,
  onOpenChange,
  tables,
  snippets,
  onOpenTable,
  onOpenSnippet,
  onRunCurrent,
  onRunAll,
  onPrettify,
  onNewQuery,
  onToggleLeft,
  onToggleRight,
}: DataSpotlightProps) {
  // Close the dialog, then run the action on the next tick so focus returns
  // cleanly to the editor.
  const act = (fn: () => void) => () => {
    onOpenChange(false);
    queueMicrotask(fn);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Data console">
      <CommandInput placeholder="Run, prettify, jump to a table or snippet…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={act(onRunCurrent)}>
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-4" />
            Run current statement
          </CommandItem>
          <CommandItem onSelect={act(onRunAll)}>
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-4" />
            Run all statements
          </CommandItem>
          <CommandItem onSelect={act(onPrettify)}>
            <HugeiconsIcon icon={MagicWand01Icon} strokeWidth={2} className="size-4" />
            Prettify SQL
          </CommandItem>
          <CommandItem onSelect={act(onNewQuery)}>
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4" />
            New query
          </CommandItem>
          <CommandItem onSelect={act(onToggleLeft)}>
            <HugeiconsIcon icon={SidebarLeft01Icon} strokeWidth={2} className="size-4" />
            Toggle snippets panel
          </CommandItem>
          <CommandItem onSelect={act(onToggleRight)}>
            <HugeiconsIcon icon={SidebarRight01Icon} strokeWidth={2} className="size-4" />
            Toggle tables panel
          </CommandItem>
        </CommandGroup>

        {snippets.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Snippets">
              {snippets.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`snippet ${s.name}`}
                  onSelect={act(() => onOpenSnippet(s.id))}
                >
                  <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4" />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {tables.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tables">
              {tables.map((t) => (
                <CommandItem
                  key={`${t.schema}.${t.name}`}
                  value={`table ${t.schema}.${t.name}`}
                  onSelect={act(() => onOpenTable(t))}
                >
                  <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-4" />
                  {t.schema === "public" ? t.name : `${t.schema}.${t.name}`}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
