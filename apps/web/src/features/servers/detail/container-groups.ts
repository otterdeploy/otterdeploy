/**
 * What runs on a host, grouped the way an operator asks about it: each
 * project's services and their containers, then the install's own platform
 * containers, then anything else on the daemon.
 *
 * The table pages its rows, so grouping is an ORDER plus headings computed
 * per page: `orderByOwner` sorts, `containerHeadings` says which heading rows
 * to draw above each row (and repeats the open ones at the top of a page),
 * and `serviceHeadingView` says how a service heading reads: the resource's
 * name linking to its panel, or "Unknown resource" with the id when the row
 * behind a container is gone.
 */

export type ContainerOwnerView =
  | {
      kind: "resource";
      resourceId: string;
      resourceName: string | null;
      projectSlug: string | null;
      projectName: string | null;
      environmentSlug: string | null;
    }
  | { kind: "platform"; role: string | null }
  | { kind: "unmanaged" };

export interface OwnedContainer {
  name: string;
  owner: ContainerOwnerView;
}

export interface ServiceHeading {
  resourceId: string;
  resourceName: string | null;
  projectSlug: string | null;
  environmentSlug: string | null;
}

const PLATFORM = "Platform";
const UNMANAGED = "Unmanaged";
const UNKNOWN_PROJECT = "Unknown project";
const UNKNOWN_RESOURCE = "Unknown resource";

interface Placement {
  rank: number;
  group: string;
  service: ServiceHeading | null;
  /** Sort key within the group: named resources first, by name, then
   *  unresolved ones by id. */
  serviceKey: string;
}

function placement(c: OwnedContainer): Placement {
  if (c.owner.kind === "resource") {
    const { resourceId, resourceName, projectSlug, environmentSlug } = c.owner;
    return {
      rank: 0,
      group: c.owner.projectName ?? projectSlug ?? UNKNOWN_PROJECT,
      service: { resourceId, resourceName, projectSlug, environmentSlug },
      serviceKey: resourceName === null ? `1:${resourceId}` : `0:${resourceName}`,
    };
  }
  if (c.owner.kind === "platform")
    return { rank: 1, group: PLATFORM, service: null, serviceKey: "" };
  return { rank: 2, group: UNMANAGED, service: null, serviceKey: "" };
}

export function orderByOwner<C extends OwnedContainer>(containers: readonly C[]): C[] {
  return [...containers].sort((a, b) => {
    const pa = placement(a);
    const pb = placement(b);
    return (
      pa.rank - pb.rank ||
      pa.group.localeCompare(pb.group) ||
      pa.serviceKey.localeCompare(pb.serviceKey) ||
      a.name.localeCompare(b.name)
    );
  });
}

export interface ContainerHeading {
  /** A group heading to draw above this row (project name, Platform,
   *  Unmanaged), or null when the row continues the open group. */
  group: string | null;
  /** A service heading within a project, or null. */
  service: ServiceHeading | null;
}

/** One entry per row, for rows already in `orderByOwner` order. */
export function containerHeadings(rows: readonly OwnedContainer[]): ContainerHeading[] {
  let openGroup: string | null = null;
  let openService: string | null = null;
  return rows.map((row) => {
    const { group, service } = placement(row);
    const serviceId = service?.resourceId ?? null;
    const newGroup = group !== openGroup;
    const newService = newGroup || serviceId !== openService;
    openGroup = group;
    openService = serviceId;
    return { group: newGroup ? group : null, service: newService ? service : null };
  });
}

export type ServiceHeadingView =
  | { kind: "link"; label: string; projectSlug: string; envSlug: string; resourceId: string }
  | { kind: "text"; label: string }
  | { kind: "unknown"; label: typeof UNKNOWN_RESOURCE; resourceId: string };

export function serviceHeadingView(service: ServiceHeading): ServiceHeadingView {
  if (service.resourceName === null) {
    return { kind: "unknown", label: UNKNOWN_RESOURCE, resourceId: service.resourceId };
  }
  if (service.projectSlug && service.environmentSlug) {
    return {
      kind: "link",
      label: service.resourceName,
      projectSlug: service.projectSlug,
      envSlug: service.environmentSlug,
      resourceId: service.resourceId,
    };
  }
  return { kind: "text", label: service.resourceName };
}
