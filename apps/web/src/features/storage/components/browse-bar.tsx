/**
 * ONE bar holding the breadcrumb, the filter tokens and the grouping toggle.
 *
 * They share it because they edit one piece of state. Splitting them into a
 * path control and a separate search box would let the two disagree about what
 * is being looked at — the exact confusion that made "folders" and "flat" feel
 * like two different screens instead of two renderings.
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Crumb, Grouping } from "../browse-state";

export function BrowseBar({
  crumbs,
  query,
  grouping,
  onNavigate,
  onQueryChange,
  onGroupingChange,
}: {
  crumbs: readonly Crumb[];
  query: string;
  grouping: Grouping;
  onNavigate: (prefix: string) => void;
  onQueryChange: (next: string) => void;
  onGroupingChange: (next: Grouping) => void;
}) {
  const tokens = query.split(/\s+/).filter(Boolean);
  const removeToken = (token: string) => onQueryChange(tokens.filter((t) => t !== token).join(" "));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-2">
      <span className="font-mono text-[13px] text-primary">▸</span>

      <nav className="flex items-center font-mono text-[12.5px]" aria-label="Bucket path">
        {crumbs.map((crumb, i) => (
          <span key={crumb.prefix} className="flex items-center">
            {i > 0 ? <span className="px-0.5 text-muted-foreground/40">/</span> : null}
            <button
              type="button"
              onClick={() => onNavigate(crumb.prefix)}
              className={cn(
                "rounded px-1 py-0.5 transition-colors hover:bg-muted",
                i === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {crumb.label}
            </button>
          </span>
        ))}
        {crumbs.length > 1 ? <span className="px-0.5 text-muted-foreground/40">/</span> : null}
      </nav>

      {tokens.map((token) => (
        <span
          key={token}
          className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-primary/10 px-1.5 font-mono text-[11.5px] ring-1 ring-primary/25"
        >
          {token}
          <button
            type="button"
            aria-label={`Remove filter ${token}`}
            onClick={() => removeToken(token)}
            className="text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        </span>
      ))}

      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="filter…"
        title="size:>1MB · class:GLACIER_IR · type:pdf · prefix:… · or any substring"
        className="h-6 min-w-[140px] flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={grouping === "folders" ? "secondary" : "outline"}
          className="h-6 px-2 text-[12px]"
          onClick={() => onGroupingChange("folders")}
        >
          Folders
        </Button>
        <Button
          size="sm"
          variant={grouping === "flat" ? "secondary" : "outline"}
          className="h-6 px-2 text-[12px]"
          onClick={() => onGroupingChange("flat")}
        >
          Flat
        </Button>
      </div>
    </div>
  );
}
