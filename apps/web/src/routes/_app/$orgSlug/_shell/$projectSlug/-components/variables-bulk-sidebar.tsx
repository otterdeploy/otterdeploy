import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import type { ParsedVar } from "./variables-dotenv";
import type { EnvironmentRef } from "./variables-types";

export function BulkEditSidebar({
  allEnvs,
  targetIds,
  onToggleTarget,
  parsed,
}: {
  allEnvs: EnvironmentRef[];
  targetIds: Set<string>;
  onToggleTarget: (envId: string) => void;
  parsed: ParsedVar[];
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Apply to
        </div>
        <div className="flex flex-col gap-0.5">
          {allEnvs.map((e) => (
            <label
              key={e.id}
              className="flex cursor-pointer items-center gap-2 py-1 text-xs"
            >
              <Checkbox
                checked={targetIds.has(e.id)}
                onCheckedChange={() => onToggleTarget(e.id)}
                aria-label={`Apply to ${e.name || e.slug}`}
              />
              <EnvDot slug={e.slug} />
              <span className="capitalize">{e.name || e.slug}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview
        </div>
        <div className="font-mono text-xs text-foreground/80">
          {parsed.length} variables parsed
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {parsed.filter((p) => p.isSecret).length} marked secret
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="min-h-0">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Detected
        </div>
        <div className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/80">
          {parsed.slice(0, 12).map((p) => (
            <div key={p.key} className="flex gap-1.5 py-0.5">
              <span
                className={p.isSecret ? "text-amber-500" : "text-muted-foreground"}
              >
                {p.isSecret ? "••" : "  "}
              </span>
              <span className="truncate">{p.key}</span>
            </div>
          ))}
          {parsed.length > 12 && (
            <div className="text-[10px] text-muted-foreground">
              +{parsed.length - 12} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EnvDot({ slug }: { slug: string }) {
  // Slug-based tone — production/main → emerald, staging → amber,
  // anything else (preview / feature branches) → blue.
  const tone =
    slug === "production" || slug === "main" || slug === "prod"
      ? "bg-emerald-500"
      : slug === "staging" || slug === "stage" || slug === "stg"
        ? "bg-amber-500"
        : "bg-blue-500";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}
