import { PostgresVarRow } from "./var-rows";
import type { DerivedVar } from "./engine-service-vars";

interface ServiceVarsListProps {
  filteredService: DerivedVar[];
  query: string;
  revealed: Set<string>;
  copiedKey: string | null;
  onToggleReveal: (name: string) => void;
  onCopy: (value: string, name: string) => void;
}

export function ServiceVarsList({
  filteredService,
  query,
  revealed,
  copiedKey,
  onToggleReveal,
  onCopy,
}: ServiceVarsListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/40">
      {filteredService.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          No variables match “{query}”.
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {filteredService.map((v) => (
            <PostgresVarRow
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
    </div>
  );
}
