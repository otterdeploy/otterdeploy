/**
 * The SQL-playground editor toolbar — run (with a statement/selection/all
 * dropdown), prettify, the audited write-mode switch, and the snippets / schema
 * rail toggles. Split out of {@link SqlPlaygroundView} to keep both small.
 */

import type { RefObject } from "react";

import {
  ArrowDown01Icon,
  Clock01Icon,
  MagicWand01Icon,
  PlayIcon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Kbd } from "@/shared/components/ui/kbd";
import { Separator } from "@/shared/components/ui/separator";
import { Switch } from "@/shared/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

import type { SqlEditorHandle } from "./components/sql-editor";
import type { DataStudioController } from "./use-data-studio";

import { HistoryPopover } from "./components/history-popover";

export function SqlToolbar({
  studio,
  editorRef,
}: {
  studio: DataStudioController;
  editorRef: RefObject<SqlEditorHandle | null>;
}) {
  const { table: t, editor } = studio;
  const editorEmpty = editor.editorValue.trim().length === 0;
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-2">
      {/* Left — run + edit actions */}
      <div className="flex items-center gap-1">
        <div className="flex items-center">
          <Button
            size="sm"
            className="gap-1.5 rounded-r-none"
            disabled={t.rowsQuery.isFetching || editorEmpty}
            onClick={() => editorRef.current?.runCurrent()}
          >
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
            Run
            <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">⌘↵</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                  disabled={editorEmpty}
                  aria-label="Run options"
                />
              }
            >
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => editorRef.current?.runCurrent()}>
                Run current statement
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editorRef.current?.runSelection()}>
                Run selection
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editorRef.current?.runAll()}>
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
          onClick={editor.prettify}
        >
          <HugeiconsIcon icon={MagicWand01Icon} strokeWidth={2} className="size-3.5" />
          Prettify
        </Button>
        <HistoryPopover
          entries={t.history.entries}
          onPick={studio.loadFromHistory}
          onClear={t.history.clear}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Query history">
              <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          }
        />
        {t.canWrite ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <label
                    htmlFor="sql-write-mode"
                    className="flex cursor-pointer items-center gap-1.5 text-[12px]"
                  />
                }
              >
                <Switch
                  id="sql-write-mode"
                  checked={t.writeMode}
                  onCheckedChange={t.setWriteMode}
                  disabled={t.executeSql.isPending}
                  aria-label="SQL write mode"
                />
                <span
                  className={t.writeMode ? "font-medium text-amber-500" : "text-muted-foreground"}
                >
                  {t.executeSql.isPending ? "Running…" : "Write"}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Run arbitrary DML/DDL (audited) instead of a read-only query.
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => studio.setShowLeft((v) => !v)}
                aria-label="Toggle snippets panel"
              />
            }
          >
            <HugeiconsIcon icon={SidebarLeft01Icon} strokeWidth={2} className="size-3.5" />
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
          variant={studio.showRight ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => studio.setShowRight((v) => !v)}
        >
          <HugeiconsIcon icon={SidebarRight01Icon} strokeWidth={2} className="size-3.5" />
          Columns
        </Button>
      </div>
    </div>
  );
}
