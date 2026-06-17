import { ChevronsUpDown, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// Version row at the top of the docs sidebar, modelled on Better Auth's
// "v1.6 (Latest)" selector. We ship one docs version, so the row is a static
// label styled as a selector — the right ⇅ chevron mirrors the reference; it
// isn't a working version switcher.
export function DocsVersion() {
  return (
    <div className="-mx-2 flex items-center gap-2.5 border-b border-border px-5 py-3 text-[13px] text-muted-foreground">
      <HugeiconsIcon icon={GitBranchIcon} className="size-4 shrink-0" />
      <span className="font-medium text-foreground">v0.1.0</span>
      <span className="text-muted-foreground/70">(Latest)</span>
      <HugeiconsIcon
        icon={ChevronsUpDown}
        className="ml-auto size-4 shrink-0 text-muted-foreground/70"
      />
    </div>
  );
}
