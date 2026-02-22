import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GlobeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";

import { kindOptions } from "./create-resource-palette";

export interface PendingChange {
  id: string;
  name: string;
  kind: string;
  action: "added" | "modified" | "removed";
  settings: { key: string; oldValue: string; newValue: string }[];
}

export function ChangesDialog({
  changes,
  open,
  onOpenChange,
  onDeploy,
  onDiscard,
}: {
  changes: PendingChange[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeploy: () => void;
  onDiscard: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] !w-[95vw] !h-[92vh] flex flex-col !p-0 !gap-0 !rounded-2xl">
        <DialogHeader className="px-8 pt-8 pb-5 shrink-0">
          <DialogTitle className="text-2xl font-bold">
            {changes.length} {changes.length === 1 ? "change" : "changes"} to apply
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review pending changes before deploying.
          </DialogDescription>
        </DialogHeader>

        {/* Commit message */}
        <div className="px-8 pb-5 shrink-0">
          <Input placeholder="Commit message (optional)" className="h-11 text-base" />
        </div>

        {/* Changes list */}
        <div className="border-t border-border/40 flex-1 overflow-y-auto min-h-0">
          {changes.map((change) => {
            const isExpanded = expanded[change.id] ?? true;
            const kindIcon = kindOptions.find((o) => o.value === change.kind)?.icon ?? GlobeIcon;

            return (
              <div key={change.id} className="border-b border-border/40 last:border-b-0">
                {/* Change header */}
                <button
                  type="button"
                  className="flex w-full items-center gap-4 px-8 py-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded((prev) => ({ ...prev, [change.id]: !isExpanded }))}
                >
                  <ChevronDownIcon
                    className={`size-5 text-muted-foreground transition-transform ${
                      !isExpanded ? "-rotate-90" : ""
                    }`}
                  />
                  <HugeiconsIcon icon={kindIcon} className="size-6 text-muted-foreground" />
                  <span className="flex-1 text-base">
                    <strong className="text-foreground">{change.name}</strong>{" "}
                    <span className="text-muted-foreground">will be {change.action}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {change.settings.length} Settings
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscard(change.id);
                    }}
                  >
                    Discard
                  </Button>
                </button>

                {/* Settings table */}
                {isExpanded && change.settings.length > 0 && (
                  <div className="px-8 pb-5">
                    <div className="rounded-xl border border-border/40 overflow-hidden">
                      {/* Table header */}
                      <div className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-0 bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Change</span>
                        <span>Current Value</span>
                        <span>New Value</span>
                        <span className="w-8" />
                      </div>
                      {/* Rows */}
                      {change.settings.map((setting) => (
                        <div
                          key={setting.key}
                          className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-0 items-center border-t border-border/30 px-5 py-3.5"
                        >
                          <span className="flex items-center gap-3 text-sm">
                            <PlusIcon className="size-3.5 text-emerald-500 shrink-0" />
                            <Settings2Icon className="size-4 text-muted-foreground shrink-0" />
                            {setting.key}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {setting.oldValue || "\u2014"}
                          </span>
                          <span className="text-sm">
                            {setting.newValue && (
                              <code className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-mono text-emerald-400">
                                {setting.newValue}
                              </code>
                            )}
                          </span>
                          <button
                            type="button"
                            className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <XIcon className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/40 px-8 py-5 shrink-0">
          <span className="text-sm text-muted-foreground">
            {changes.map((c) => c.name).join(", ")} will redeploy
          </span>
          <Button size="lg" onClick={onDeploy} className="gap-2 text-base px-6">
            <CheckIcon className="size-5" />
            Deploy Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
