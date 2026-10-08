/**
 * Mounts the project's self-signed host set (see ./self-signed-hosts) from the
 * live proxy-routes collection. Lives at the project layout so every surface
 * below it can mark a URL without fetching routes itself.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useMemo, type ReactNode } from "react";

import { eq, useLiveQuery } from "@tanstack/react-db";

import { proxyRoutesCollection } from "./proxy-routes";
import { SelfSignedHostsProvider, selfSignedHosts } from "./self-signed-hosts";

/** Reads the project's routes and provides their self-signed hosts. */
export function ProjectSelfSignedHosts({
  projectId,
  children,
}: {
  projectId: ProjectId;
  children: ReactNode;
}) {
  const { data: routes } = useLiveQuery(
    (q) => q.from({ r: proxyRoutesCollection }).where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );
  const hosts = useMemo(() => selfSignedHosts(routes ?? []), [routes]);
  return <SelfSignedHostsProvider hosts={hosts}>{children}</SelfSignedHostsProvider>;
}
