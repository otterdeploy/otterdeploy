import type { ProjectSlug } from "@otterdeploy/shared/id-brands";
import type { InboxSubject } from "@otterdeploy/shared/inbox-subject";
import type { JsonObject } from "@otterdeploy/shared/json";

/**
 * Where a notification leads.
 *
 * A subject plus the row's payload resolves to one typed route: a service
 * opens its panel on the deployment in question, a server opens install
 * health, a backup source opens the backups activity, a domain opens the
 * edge logs. Resolved here, once, so a card and a history row cannot
 * disagree about where "Open" goes. Legacy subjects (no real id) resolve to
 * nothing and render no link rather than a broken one.
 */
import type { ReactNode } from "react";

import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { Link } from "@tanstack/react-router";

export type InboxTarget =
  | {
      kind: "service";
      projectSlug: ProjectSlug;
      resourceId: string;
      deploymentId: string | null;
    }
  | { kind: "servers" }
  | { kind: "backups" }
  | { kind: "edge" };

const projectSlugSchema = zSlug(ID_PREFIX.project);

export function inboxTarget(
  subject: InboxSubject | null,
  data: JsonObject | null | undefined,
): InboxTarget | null {
  if (!subject || subject.id.startsWith("legacy:")) return null;
  switch (subject.kind) {
    case "service": {
      // The slug is a branded route param; a subject written with a slug that
      // does not parse gets no link rather than a route that cannot match.
      const slug = projectSlugSchema.safeParse(subject.project);
      if (!slug.success) return null;
      const deploymentId = data?.deploymentId;
      return {
        kind: "service",
        projectSlug: slug.data,
        resourceId: subject.id,
        deploymentId: typeof deploymentId === "string" && deploymentId !== "" ? deploymentId : null,
      };
    }
    case "server":
      return { kind: "servers" };
    case "backup":
      return { kind: "backups" };
    case "edge":
      return { kind: "edge" };
    case "account":
      return null;
  }
}

/**
 * One link, typed per destination. `view` picks which face of a service
 * panel opens: the deployment row, or the build log that explains it.
 */
export function InboxLink({
  orgSlug,
  target,
  view = "deployment",
  className,
  children,
  onClick,
}: {
  orgSlug: string;
  target: InboxTarget;
  view?: "deployment" | "build-log";
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  switch (target.kind) {
    case "service":
      return (
        <Link
          to="/$orgSlug/$projectSlug/graph/$resourceId"
          params={{ orgSlug, projectSlug: target.projectSlug, resourceId: target.resourceId }}
          search={
            view === "build-log"
              ? { tab: "logs", logSource: "build", deployment: target.deploymentId ?? undefined }
              : { tab: "deployments", deployment: target.deploymentId ?? undefined }
          }
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      );
    case "servers":
      return (
        <Link
          to="/$orgSlug/servers"
          params={{ orgSlug }}
          search={{ tab: "install-health" }}
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      );
    case "backups":
      return (
        <Link
          to="/$orgSlug/backups"
          params={{ orgSlug }}
          search={{ view: "activity" }}
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      );
    case "edge":
      return (
        <Link
          to="/$orgSlug/edge"
          params={{ orgSlug }}
          search={{ tab: "logs" }}
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      );
  }
}
