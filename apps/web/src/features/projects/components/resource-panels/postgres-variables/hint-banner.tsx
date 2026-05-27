import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Link01Icon } from "@hugeicons/core-free-icons";

export function VariableRefHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12.5px]">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Link01Icon}
          strokeWidth={2}
          className="size-3.5 text-primary"
        />
        <span className="text-foreground/80">
          Trying to connect this database to a service? Add a{" "}
          <button
            type="button"
            className="font-medium text-primary underline underline-offset-2"
          >
            Variable Reference
          </button>
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}
