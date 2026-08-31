/**
 * The Table-browse layout for the Data studio: the rail beside the shared
 * results panel. Driven by the {@link DataStudioController}.
 */

import { useState, type ReactNode } from "react";

import { Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

import type { DataStudioController } from "./use-data-studio";

import { RailContent } from "./components/workbench-rail";

export function TableBrowserView({
  studio,
  results,
}: {
  studio: DataStudioController;
  results: ReactNode;
}) {
  const t = studio.table;
  const [railOpen, setRailOpen] = useState(false);
  const selectedLabel = t.selected
    ? t.selected.schema === "public"
      ? t.selected.name
      : `${t.selected.schema}.${t.selected.name}`
    : "Tables";

  return (
    <div className="flex h-full min-h-0 w-full">
      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Tables</SheetTitle>
            <SheetDescription>Pick a table to browse.</SheetDescription>
          </SheetHeader>
          <RailContent studio={studio} onPick={() => setRailOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main: filters + grid + pagination. The rail and the tab strip live
          one level up in the workbench shell, shared with the SQL layout. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Stands in for the hidden rail: names the open table and opens the
            picker. Only below `sm`, where the rail isn't on screen. */}
        <div className="flex items-center gap-2 border-b px-2 py-1.5 sm:hidden">
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-w-0 gap-1.5 text-[12px]"
            onClick={() => setRailOpen(true)}
          >
            <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            <span className="truncate">{selectedLabel}</span>
          </Button>
        </div>
        {results}
      </div>
    </div>
  );
}
