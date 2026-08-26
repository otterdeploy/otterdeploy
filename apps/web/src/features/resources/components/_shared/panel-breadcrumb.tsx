/**
 * Where you are, and how to get somewhere else.
 *
 * `acme / netbird / dashboard` — rooted at the PROJECT, never the org. That
 * root is the reason this isn't a child-only affordance: every panel has a
 * project, so every panel gets a crumb, and the crumb's root doubles as the
 * resource switcher. One control answers three questions: where am I, how do
 * I get back, and how do I get anywhere else.
 *
 * The middle segment only appears for a compose stack's child. Until this
 * existed, clicking a service inside a stack on the canvas
 * (`compose-group-node.tsx`) opened a panel that said nothing about the stack
 * it belonged to, and ✕ returned to the graph rather than to the stack — so
 * the only route back into a stack you were already inside was to find it on
 * the canvas again.
 *
 * Both segments are real links, so ⌘-click and middle-click open tabs like
 * anything else.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { orpc } from "@/shared/server/orpc";

import { ResourceSwitcher } from "./resource-switcher";

export interface PanelCrumb {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: string;
  projectName: string;
  /** The stack this resource belongs to (a service's `stackId`). The name is
   *  resolved here rather than threaded through every panel, because the panel
   *  holds one resource and the parent is a different one. */
  parentResourceId?: string | null;
  /** The open resource, so the switcher can mark it. */
  currentResourceId?: string;
}

export function PanelBreadcrumb({ crumb }: { crumb: PanelCrumb }) {
  const [open, setOpen] = useState(false);
  const projectName = crumb.projectName;
  // Same query key the graph page already warmed, so resolving the parent's
  // name costs a cache read rather than a request. `enabled` keeps a panel
  // with no parent from fetching at all.
  const resources = useQuery({
    ...orpc.project.resource.list.queryOptions({ input: { projectId: crumb.projectId } }),
    enabled: crumb.parentResourceId != null,
  });
  const parent = crumb.parentResourceId
    ? (resources.data ?? []).find((r) => r.resourceId === crumb.parentResourceId)
    : undefined;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          // A button, not a link: the root's job is switching, and the
          // project's own page is one more click away in the menu. Making it
          // navigate on click would put a page load between the operator and
          // the list they opened it for.
          className="-mx-1 flex min-w-0 shrink-0 items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Switch resource — currently in ${projectName}`}
        >
          <span className="truncate">{projectName}</span>
          {/* Visible at rest, not on hover: a menu nobody can see is a menu
              nobody opens. */}
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2.5} className="size-3 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          {/* Rendered only while open, so the resource list is fetched when
              someone asks for it rather than on every panel mount. */}
          <ResourceSwitcher
            crumb={crumb}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {crumb.parentResourceId && (
        <>
          <span className="shrink-0 opacity-50">/</span>
          <Link
            to="/$orgSlug/$projectSlug/graph/$resourceId"
            params={{
              orgSlug: crumb.orgSlug,
              projectSlug: crumb.projectSlug,
              resourceId: crumb.parentResourceId,
            }}
            className="-mx-1 min-w-0 truncate rounded px-1 py-0.5 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {/* The id is the truth; the name is a nicety that arrives with
                the list. Render the link either way so the way back is never
                gated on a fetch. */}
            {parent?.name ?? "stack"}
          </Link>
        </>
      )}
    </nav>
  );
}
