import { toast } from "sonner";

import { Cancel01Icon, Copy01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { variablesCollection } from "@/features/projects/data/variables";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

import type { EnvVarRow } from "./variables-types";

export function EnvVarRowItem({
  row,
  revealAll,
  selected,
  onToggle,
}: {
  row: EnvVarRow;
  revealAll: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="group grid grid-cols-[32px_24px_1fr_2fr_120px] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30">
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${row.key}`}
      />
      <HugeiconsIcon
        icon={Key01Icon}
        className="size-3 text-muted-foreground/70"
      />
      <span className="font-mono text-xs font-medium">{row.key}</span>
      <span className="min-w-0 truncate border-l pl-3">
        {row.value === "" ? (
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60">
            EMPTY
          </span>
        ) : (
          <span
            className={cn(
              "font-mono text-xs",
              row.isSecret && !revealAll
                ? "text-muted-foreground"
                : "text-foreground/85",
            )}
          >
            {row.isSecret && !revealAll
              ? "••••••••••••••••••••••••••••"
              : row.value}
          </span>
        )}
      </span>
      <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Copy"
          onClick={() => {
            void copyToClipboard(row.value).then((ok) =>
              ok ? toast.success(`Copied ${row.key}`) : toast.error("Couldn't copy"),
            );
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-rose-500 hover:text-rose-500"
          title="Delete"
          onClick={() => {
            const tx = variablesCollection.delete(row.id);
            tx.isPersisted.promise.catch((err: unknown) =>
              toast.error(
                err instanceof Error ? err.message : "Couldn't delete",
              ),
            );
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
        </Button>
      </span>
    </div>
  );
}
