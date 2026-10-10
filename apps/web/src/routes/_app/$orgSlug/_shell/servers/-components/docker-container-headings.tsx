/**
 * The heading rows the containers table draws between groups: a project (or
 * Platform / Unmanaged), and a service within a project. Grouping and the
 * heading wording are decided in features/servers/detail/container-groups.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { Link, useParams } from "@tanstack/react-router";

import {
  type ServiceHeading,
  serviceHeadingView,
} from "@/features/servers/detail/container-groups";
import { TableCell, TableRow } from "@/shared/components/ui/table";

const projectSlugSchema = zSlug(ID_PREFIX.project);

/** A project (or Platform / Unmanaged) heading row. Spans the table so the
 *  columns stay aligned. */
export function GroupHeadingRow({ label }: { label: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={6}
        className="bg-muted/40 pt-3 pb-1.5 pl-4 text-[12px] font-medium text-foreground"
      >
        {label}
      </TableCell>
    </TableRow>
  );
}

/** A service heading within a project: the resource's name, linking to its
 *  panel; or "Unknown resource" with the id when its row is gone (a deleted
 *  resource, or a container another install left on this daemon). */
export function ServiceHeadingRow({ service }: { service: ServiceHeading }) {
  const { orgSlug } = useParams({ strict: false });
  const view = serviceHeadingView(service);
  const projectSlug = view.kind === "link" ? projectSlugSchema.safeParse(view.projectSlug) : null;
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={6} className="pt-2 pb-1 pl-6 text-[12.5px]">
        {view.kind === "link" && orgSlug && projectSlug?.success ? (
          <Link
            to="/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId"
            params={{
              orgSlug,
              projectSlug: projectSlug.data,
              envSlug: view.envSlug,
              resourceId: view.resourceId,
            }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {view.label}
          </Link>
        ) : view.kind === "unknown" ? (
          <span className="inline-flex items-baseline gap-2">
            <span className="text-muted-foreground">{view.label}</span>
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {view.resourceId}
            </span>
          </span>
        ) : (
          <span className="font-medium text-foreground">{view.label}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
