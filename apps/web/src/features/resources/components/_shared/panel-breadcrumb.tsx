/**
 * Where you are: `acme / netbird / dashboard`, rooted at the PROJECT.
 *
 * Plain text plus a link to the parent stack. It used to also be the resource
 * switcher (a popover on the root), which put "go somewhere else" in a
 * different place from the member strip's "go to a sibling". The strip's head
 * is the one switcher now (see stack-member-strip.tsx); this only says where
 * you are.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/shared/server/orpc";

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
      <span className="truncate">{crumb.projectName}</span>
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
            search={(prev) => ({ tab: prev.tab })}
            replace
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
