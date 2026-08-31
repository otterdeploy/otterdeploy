/**
 * ONE bar holding the breadcrumb, the filter tokens, the grouping toggle and
 * the workbench verbs (stats, upload) — the top row of the surface, now that
 * the bucket switcher lives in the header crumb trail.
 *
 * Breadcrumb, tokens and toggle share it because they edit one piece of
 * state. Splitting them into a path control and a separate search box would
 * let the two disagree about what is being looked at — the exact confusion
 * that made "folders" and "flat" feel like two different screens instead of
 * two renderings.
 *
 * Tokens commit on Enter and pop with Backspace on an empty input, so the
 * chips always show what is APPLIED, never a half-typed token.
 */
import { useRef, useState } from "react";

import { Analytics01Icon, Cancel01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { withStorageToken } from "@otterdeploy/shared/storage-filter";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Crumb, Grouping } from "../state";

export function BrowseBar({
  crumbs,
  query,
  grouping,
  statsOpen,
  uploading,
  onNavigate,
  onQueryChange,
  onGroupingChange,
  onToggleStats,
  onUpload,
}: {
  crumbs: readonly Crumb[];
  query: string;
  grouping: Grouping;
  statsOpen: boolean;
  uploading: boolean;
  onNavigate: (prefix: string) => void;
  onQueryChange: (next: string) => void;
  onGroupingChange: (next: Grouping) => void;
  onToggleStats: () => void;
  onUpload: (files: readonly File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const tokens = query.split(/\s+/).filter(Boolean);
  const removeToken = (token: string) => onQueryChange(withStorageToken(query, token));

  const commitDraft = () => {
    const token = draft.trim();
    if (token === "") return;
    onQueryChange(withStorageToken(query, token));
    setDraft("");
  };

  return (
    // h-10 to the pixel, like the rail header and the preview header: the
    // three panes' first border-b must read as ONE line. One row, no wrap —
    // overflowing crumbs and tokens scroll inside their own lane instead of
    // growing the bar.
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <div className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-2 overflow-x-auto">
        <nav
          className="flex shrink-0 items-center font-mono text-[12.5px]"
          aria-label="Bucket path"
        >
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
            className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md bg-primary/10 px-1.5 font-mono text-[11.5px] ring-1 ring-primary/25 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:zoom-in-95"
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Backspace" && draft === "" && tokens.length > 0) {
              const last = tokens.at(-1);
              if (last !== undefined) removeToken(last);
            }
          }}
          placeholder="filter…"
          title="size:>1MB · modified:<30d · class:GLACIER_IR · type:pdf · prefix:… · or any substring, ↵ to apply"
          className="h-6 min-w-[120px] flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div aria-hidden className="h-4 w-px shrink-0 bg-border" />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={grouping === "folders" ? "secondary" : "outline"}
          className="h-6 px-2 text-[12px]"
          aria-pressed={grouping === "folders"}
          onClick={() => onGroupingChange("folders")}
        >
          Folders
        </Button>
        <Button
          size="sm"
          variant={grouping === "flat" ? "secondary" : "outline"}
          className="h-6 px-2 text-[12px]"
          aria-pressed={grouping === "flat"}
          onClick={() => onGroupingChange("flat")}
        >
          Flat
        </Button>
      </div>

      <div aria-hidden className="h-4 w-px shrink-0 bg-border" />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={statsOpen ? "secondary" : "outline"}
          className="h-6 gap-1.5 px-2 text-[12px]"
          aria-pressed={statsOpen}
          onClick={onToggleStats}
        >
          <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} className="size-3.5" />
          Stats
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1.5 px-2 text-[12px]"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className="size-3.5" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onUpload([...(e.target.files ?? [])]);
            // Same file picked twice should upload twice.
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
