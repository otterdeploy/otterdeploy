/**
 * Row primitives for the snippet tree — the generic {@link Row} (icon +
 * inline-rename input + hover menu), the per-item {@link ItemMenu}, and the
 * {@link FolderNode} that renders a folder header over its child snippets.
 * Pulled into a sibling module so {@link SnippetTree} stays small.
 */

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  File01Icon,
  Folder01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

import type { SqlFolder, SqlSnippet } from "../data/use-sql-snippets";

export function Row({
  icon,
  chevron,
  label,
  active,
  indent,
  renaming,
  onRename,
  onClick,
  menu,
}: {
  icon: typeof File01Icon;
  chevron?: typeof ArrowDown01Icon;
  label: string;
  active?: boolean;
  indent?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onClick?: () => void;
  menu?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        indent && "ml-3",
      )}
    >
      {chevron ? (
        <HugeiconsIcon icon={chevron} strokeWidth={2} className="size-3 shrink-0" />
      ) : null}
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0" />
      {renaming && onRename ? (
        <input
          autoFocus
          defaultValue={label}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRename((e.target as HTMLInputElement).value);
            if (e.key === "Escape") onRename(label);
          }}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 truncate text-left"
          title={label}
        >
          {label}
        </button>
      )}
      {menu ? (
        <span className="opacity-0 transition-opacity group-hover:opacity-100">{menu}</span>
      ) : null}
    </div>
  );
}

export function ItemMenu({
  onRename,
  onNewQuery,
  onDelete,
}: {
  onRename: () => void;
  onNewQuery?: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Snippet actions"
      >
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-3.5" />
          Rename
        </DropdownMenuItem>
        {onNewQuery ? (
          <DropdownMenuItem onSelect={onNewQuery}>
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-3.5" />
            New query
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A folder header over its (already filtered) child snippets. The parent owns
 *  the open/collapsed + renaming state and passes handlers down. */
export function FolderNode({
  folder,
  isOpen,
  items,
  activeId,
  renamingId,
  setRenamingId,
  toggleFolder,
  renameFolder,
  deleteFolder,
  newQuery,
  onSelect,
  renameSnippet,
  deleteSnippet,
}: {
  folder: SqlFolder;
  isOpen: boolean;
  items: SqlSnippet[];
  activeId: string;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  toggleFolder: (id: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  newQuery: (folderId: string) => void;
  onSelect: (id: string) => void;
  renameSnippet: (id: string, name: string) => void;
  deleteSnippet: (id: string) => void;
}) {
  return (
    <div>
      <Row
        icon={Folder01Icon}
        chevron={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
        label={folder.name}
        renaming={renamingId === folder.id}
        onRename={(name) => {
          renameFolder(folder.id, name);
          setRenamingId(null);
        }}
        onClick={() => toggleFolder(folder.id)}
        menu={
          <ItemMenu
            onRename={() => setRenamingId(folder.id)}
            onNewQuery={() => newQuery(folder.id)}
            onDelete={() => deleteFolder(folder.id)}
          />
        }
      />
      {isOpen
        ? items.map((s) => (
            <Row
              key={s.id}
              icon={File01Icon}
              label={s.name}
              indent
              active={activeId === s.id}
              renaming={renamingId === s.id}
              onRename={(name) => {
                renameSnippet(s.id, name);
                setRenamingId(null);
              }}
              onClick={() => onSelect(s.id)}
              menu={
                <ItemMenu
                  onRename={() => setRenamingId(s.id)}
                  onDelete={() => deleteSnippet(s.id)}
                />
              }
            />
          ))
        : null}
    </div>
  );
}
