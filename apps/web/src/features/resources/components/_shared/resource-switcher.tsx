/**
 * Jump to any resource in the project without going back to the graph.
 *
 * The panel is a right-hand drawer over the canvas, and the canvas is the
 * app's "everything" surface — so the wider the panel gets, the less of the
 * project you can see while working in it. This is the way sideways.
 *
 * Deliberately NOT a second graph: it is a flat, grouped list. The graph shows
 * the edges between resources, which a list cannot, and it is one ✕ away. What
 * this adds is the move the graph makes slow — "I am in netbird, take me to
 * postgres" — in one click, with each resource's live state visible while you
 * choose, so you notice on the way that the thing you are about to open is
 * down.
 *
 * Stack children are omitted on purpose: they live inside their stack, and a
 * flat list that mixed `dashboard` with `postgres` would imply they are peers.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  resourceStatus,
  type ProjectResource,
} from "@/features/projects/components/graph/resource-to-node";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { PanelCrumb } from "./panel-breadcrumb";

/** Dot colours, same vocabulary the graph nodes and the panel pill use. A
 *  resource with no status (never deployed) gets a hollow ring rather than a
 *  colour it hasn't earned. */
const DOT_CLASS: Record<string, string> = {
  running: "bg-success",
  building: "bg-warning",
  queued: "bg-warning/70",
  error: "bg-destructive",
  paused: "bg-muted-foreground/50",
  pending: "bg-info",
};

const GROUP_ORDER = ["compose", "service", "database"] as const;
const GROUP_LABEL: Record<(typeof GROUP_ORDER)[number], string> = {
  compose: "Stacks",
  service: "Services",
  database: "Databases",
};

export function ResourceSwitcher({
  crumb,
  onNavigate,
}: {
  crumb: PanelCrumb;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const resources = useQuery(
    orpc.project.resource.list.queryOptions({ input: { projectId: crumb.projectId } }),
  );

  const open = (resourceId: string) => {
    onNavigate();
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: {
        orgSlug: crumb.orgSlug,
        projectSlug: crumb.projectSlug,
        resourceId,
      },
    });
  };

  // Top-level only: a stack's children are reachable from inside the stack,
  // and listing them here would present them as peers of the stack itself.
  const rows = (resources.data ?? []).filter((r) => !(r.type === "service" && r.stackId != null));

  return (
    <Command>
      <CommandInput placeholder={`Go to… in ${crumb.projectName}`} />
      <CommandList>
        <CommandEmpty>
          {resources.isLoading ? "Loading resources…" : "Nothing by that name."}
        </CommandEmpty>
        {GROUP_ORDER.map((kind) => {
          const group = rows.filter((r) => r.type === kind);
          if (group.length === 0) return null;
          return (
            <CommandGroup key={kind} heading={GROUP_LABEL[kind]}>
              {group.map((resource) => (
                <SwitcherRow
                  key={resource.resourceId}
                  resource={resource}
                  current={resource.resourceId === crumb.currentResourceId}
                  onOpen={open}
                />
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </Command>
  );
}

function SwitcherRow({
  resource,
  current,
  onOpen,
}: {
  resource: ProjectResource;
  current: boolean;
  onOpen: (resourceId: string) => void;
}) {
  const status = resourceStatus(resource);
  return (
    <CommandItem
      // Name in the value so typing filters on it; the id keeps two
      // same-named resources in different environments distinct.
      value={`${resource.name} ${resource.resourceId}`}
      onSelect={() => {
        onOpen(resource.resourceId);
      }}
      // The row you are already on carries no label: cmdk's own keyboard
      // highlight is a fill too, so a second fill plus a "here" tag read as
      // two competing selections. `aria-current` keeps it announced.
      aria-current={current ? "true" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status ? DOT_CLASS[status] : "ring-1 ring-muted-foreground/40",
        )}
      />
      <span className="min-w-0 truncate">{resource.name}</span>
    </CommandItem>
  );
}
