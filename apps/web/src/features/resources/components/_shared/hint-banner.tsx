// "Add a Variable Reference" hint banner for the Variables tabs.
//
// The link is a real action: it opens the shared ReferencePicker (the same
// `${{Source.KEY}}` list the per-row { } button uses) in a popover, and a
// pick is forwarded to the editor via `onPick` so a pre-filled row appears.
// Copy adapts to the panel kind — a database panel talks about connecting
// the database to services, a service panel about pulling in another
// resource's values.

import { useState } from "react";

import { Cancel01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ReferencePicker } from "@/features/projects/components/variables";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";

export function VariableRefHint({
  onDismiss,
  projectId,
  onPick,
  context = "database",
}: {
  onDismiss: () => void;
  /** Project whose references the picker lists. */
  projectId: string;
  /** Receives the picked `${{Source.KEY}}` token — the tab inserts it as a
   *  new editor row. */
  onPick: (token: string) => void;
  /** Which panel the banner sits on — drives the copy. */
  context?: "database" | "service";
}) {
  const [open, setOpen] = useState(false);

  const lead =
    context === "database"
      ? "Trying to connect this database to a service? Add a "
      : "Need a database URL or another resource's value here? Add a ";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12.5px]">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5 text-primary" />
        <span className="text-foreground/80">
          {lead}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Variable Reference
                </button>
              }
            />
            <PopoverContent
              align="start"
              side="bottom"
              className="w-[min(26rem,calc(100vw-2rem))] p-0"
            >
              <ReferencePicker
                projectId={projectId}
                onPick={onPick}
                onClose={() => setOpen(false)}
                className="border-0 bg-transparent shadow-none"
              />
            </PopoverContent>
          </Popover>
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
      </button>
    </div>
  );
}
