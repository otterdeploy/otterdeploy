/**
 * Left-rail snippet tree. The "Playground" scratch is pinned at the top
 * (always available, cross-database); below it are user folders and top-level
 * snippets, all persisted in browser storage per the opened resource. Add via
 * the "+" menu; rename inline; per-item menus delete. Selecting an item loads
 * its SQL into the editor.
 */
import { useState } from "react";

import {
  Add01Icon,
  Bookmark01Icon,
  File01Icon,
  FolderAddIcon,
  Search01Icon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";

import { PLAYGROUND_ID, type SqlFolder, type SqlSnippet } from "../data/use-sql-snippets";
import { FolderNode, ItemMenu, Row } from "./snippet-tree-rows";

interface SnippetTreeProps {
  folders: SqlFolder[];
  snippets: SqlSnippet[];
  activeId: string;
  /** Switch back to the table browser — mirrors the table view's "SQL console". */
  onBackToTable: () => void;
  onSelect: (id: string) => void;
  addFolder: (name: string) => SqlFolder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  addSnippet: (init?: { name?: string; sql?: string; folderId?: string | null }) => SqlSnippet;
  renameSnippet: (id: string, name: string) => void;
  deleteSnippet: (id: string) => void;
}

export function SnippetTree({
  folders,
  snippets,
  activeId,
  onBackToTable,
  onSelect,
  addFolder,
  renameFolder,
  deleteFolder,
  addSnippet,
  renameSnippet,
  deleteSnippet,
}: SnippetTreeProps) {
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = search.trim().toLowerCase();
  const match = (s: SqlSnippet) => !q || s.name.toLowerCase().includes(q);

  const toggleFolder = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newQuery = (folderId: string | null) => {
    const s = addSnippet({ folderId });
    onSelect(s.id);
    setRenamingId(s.id);
  };
  const newFolder = () => {
    const f = addFolder("New folder");
    setRenamingId(f.id);
  };

  const topLevel = snippets.filter((s) => s.folderId === null && match(s));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Snippets
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Add snippet"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => newQuery(null)}>
              <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-3.5" />
              New query
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={newFolder}>
              <HugeiconsIcon icon={FolderAddIcon} strokeWidth={2} className="size-3.5" />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-2 pb-1">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets…"
            className="h-6 pl-6 text-[11px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* Back to the table browser — pinned above Playground */}
        <Row icon={Table01Icon} label="Table" onClick={onBackToTable} />

        {/* Playground — pinned, always available */}
        <Row
          icon={Bookmark01Icon}
          label="Playground"
          active={activeId === PLAYGROUND_ID}
          onClick={() => onSelect(PLAYGROUND_ID)}
        />

        {/* Folders */}
        {folders.map((folder) => {
          const isOpen = !collapsed.has(folder.id);
          const children = snippets.filter((s) => s.folderId === folder.id && match(s));
          if (q && children.length === 0) return null;
          return (
            <FolderNode
              key={folder.id}
              folder={folder}
              isOpen={isOpen}
              items={children}
              activeId={activeId}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              toggleFolder={toggleFolder}
              renameFolder={renameFolder}
              deleteFolder={deleteFolder}
              newQuery={newQuery}
              onSelect={onSelect}
              renameSnippet={renameSnippet}
              deleteSnippet={deleteSnippet}
            />
          );
        })}

        {/* Top-level snippets */}
        {topLevel.map((s) => (
          <Row
            key={s.id}
            icon={File01Icon}
            label={s.name}
            active={activeId === s.id}
            renaming={renamingId === s.id}
            onRename={(name) => {
              renameSnippet(s.id, name);
              setRenamingId(null);
            }}
            onClick={() => onSelect(s.id)}
            menu={
              <ItemMenu onRename={() => setRenamingId(s.id)} onDelete={() => deleteSnippet(s.id)} />
            }
          />
        ))}
      </div>
    </div>
  );
}
