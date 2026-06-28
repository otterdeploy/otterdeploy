/**
 * Folder list + its rows and breadcrumbs for the Root Directory picker.
 * Split out of root-directory-picker-rows.tsx to keep each file under the
 * max-lines cap. `BrowsePaneBody` renders `FolderList`; `BrowsePaneHeader`
 * renders `Breadcrumbs`.
 */

import { ArrowLeft01Icon, ArrowRight01Icon, FolderIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { cn } from "@/shared/lib/utils";

import { type InspectResult, isHiddenDir } from "./root-directory-picker-data";

export function FolderList({
  path,
  selected,
  onNavigate,
  onSelect,
  inspect,
  showHidden,
}: {
  path: string;
  selected: string;
  onNavigate: (next: string) => void;
  onSelect: (next: string) => void;
  inspect: InspectResult | undefined;
  showHidden: boolean;
}) {
  const isRoot = path === "";
  const parent = isRoot ? null : path.split("/").slice(0, -1).join("/");
  const dirs = (inspect?.entries ?? []).filter(
    (e) => e.type === "dir" && (showHidden || !isHiddenDir(e.name)),
  );
  const monorepoPackages = new Set(inspect?.monorepoPackages ?? []);

  return (
    // The radio group's `value` is the committed selection. Each row's
    // RadioGroupItem carries the folder path as its value; RadioGroup's
    // `onValueChange` lifts the pick.
    <RadioGroup
      value={selected}
      onValueChange={(next) => {
        if (typeof next === "string") onSelect(next);
      }}
      className="max-h-72 gap-0 overflow-y-auto rounded-md border bg-card"
    >
      {parent !== null && <ParentRow onClick={() => onNavigate(parent)} />}

      {/* (root) pseudo-row, only at the repo root — gives the operator
          an explicit way to commit "deploy from repo root" without
          picking a subfolder. */}
      {isRoot && (
        <FolderRow
          label="(root)"
          fullPath=""
          isPackage={false}
          isSelected={selected === ""}
          canNavigateIn={false}
          onNavigateIn={() => undefined}
        />
      )}

      {dirs.map((entry) => {
        const fullPath = path ? `${path}/${entry.name}` : entry.name;
        return (
          <FolderRow
            key={fullPath}
            label={entry.name}
            fullPath={fullPath}
            isPackage={monorepoPackages.has(fullPath)}
            isSelected={selected === fullPath}
            canNavigateIn
            onNavigateIn={() => onNavigate(fullPath)}
          />
        );
      })}

      {dirs.length === 0 && !isRoot && (
        <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
          No subfolders here
        </div>
      )}
    </RadioGroup>
  );
}

function ParentRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left hover:bg-muted/40"
    >
      <HugeiconsIcon
        icon={ArrowLeft01Icon}
        strokeWidth={2}
        className="size-3.5 text-muted-foreground"
      />
      <span className="font-mono text-[12.5px] text-muted-foreground">..</span>
    </button>
  );
}

/**
 * One row in the BrowsePane. Radio on the left (selects), folder name
 * in the middle (clicking the label also selects via the surrounding
 * `<label>`), chevron on the right (navigates IN — the only escape
 * hatch to drill deeper).
 */
function FolderRow({
  label,
  fullPath,
  isPackage,
  isSelected,
  canNavigateIn,
  onNavigateIn,
}: {
  label: string;
  fullPath: string;
  isPackage: boolean;
  isSelected: boolean;
  canNavigateIn: boolean;
  onNavigateIn: () => void;
}) {
  return (
    <label
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0",
        isSelected ? "bg-muted/50" : "hover:bg-muted/30",
      )}
    >
      <RadioGroupItem value={fullPath} />
      <HugeiconsIcon
        icon={FolderIcon}
        strokeWidth={2}
        className="size-3.5 shrink-0 text-foreground/70"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-mono text-[12.5px]">{label}</span>
        {isPackage && (
          <Badge variant="secondary" className="font-normal">
            package
          </Badge>
        )}
      </span>
      {canNavigateIn ? (
        <button
          type="button"
          onClick={(e) => {
            // Prevent the surrounding <label> from toggling the radio
            // when the operator just wants to drill deeper.
            e.preventDefault();
            e.stopPropagation();
            onNavigateIn();
          }}
          aria-label={`Browse into ${label}`}
          className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
        </button>
      ) : (
        <span className="size-7" />
      )}
    </label>
  );
}

export function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (next: string) => void;
}) {
  const segments = path ? path.split("/") : [];
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[12px]">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className={cn(
          "rounded px-1.5 py-0.5 hover:bg-muted/40",
          segments.length === 0 && "text-foreground",
        )}
      >
        /
      </button>
      {segments.map((seg, i) => {
        const upto = segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={upto} className="flex items-center gap-1">
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className="size-3 text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={() => onNavigate(upto)}
              className={cn("rounded px-1.5 py-0.5 hover:bg-muted/40", isLast && "text-foreground")}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
