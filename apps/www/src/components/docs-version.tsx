import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * The version row at the top of the docs sidebar.
 *
 * It used to render a ⇅ chevron so it read as a version switcher — but there
 * is exactly one docs version, and clicking it did nothing. An affordance that
 * doesn't afford anything is the same lie as a fake status, and DESIGN.md's
 * second principle is being honest about system state. So this is a label: it
 * says which version you're reading and stops. Put the chevron back the day
 * there is a second version to switch to.
 */
export function DocsVersion() {
  return (
    <div className="-mx-2 flex items-center gap-2.5 border-b border-border px-5 py-3 text-[0.8125rem]">
      <HugeiconsIcon
        icon={GitBranchIcon}
        strokeWidth={1.8}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="font-mono text-foreground">v0.1.0</span>
      <span className="text-muted-foreground">latest</span>
    </div>
  );
}
