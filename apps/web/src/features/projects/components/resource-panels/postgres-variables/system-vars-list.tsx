import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { PostgresSystemVarRow } from "./var-rows";
import type { DerivedVar } from "./engine-service-vars";

interface SystemVarsListProps {
  systemVars: DerivedVar[];
  filteredSystem: DerivedVar[];
  query: string;
  revealed: Set<string>;
  copiedKey: string | null;
  onToggleReveal: (name: string) => void;
  onCopy: (value: string, name: string) => void;
}

export function SystemVarsList({
  systemVars,
  filteredSystem,
  query,
  revealed,
  copiedKey,
  onToggleReveal,
  onCopy,
}: SystemVarsListProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 self-start text-[13px] font-medium text-primary hover:text-primary/80"
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
        {systemVars.length} variables added by otterdeploy
      </button>

      {open && (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            otterdeploy injects these system variables into every container —
            read-only and derived from the resource record.
          </p>
          {filteredSystem.length === 0 ? (
            <div className="rounded-lg border border-border/40 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              No system variables match “{query}”.
            </div>
          ) : (
            <div className="flex flex-col">
              {filteredSystem.map((v) => (
                <PostgresSystemVarRow
                  key={v.name}
                  v={v}
                  revealed={revealed.has(v.name)}
                  copied={copiedKey === v.name}
                  onToggleReveal={() => onToggleReveal(v.name)}
                  onCopy={() => onCopy(v.value, v.name)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
