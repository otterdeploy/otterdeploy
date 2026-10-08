/**
 * Mounts the project's self-signed host set (see ./self-signed-hosts) from the
 * live proxy-routes collection and the hosts an uploaded certificate covers.
 * Lives at the project layout so every surface below it can mark a URL without
 * fetching routes itself.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useMemo, type ReactNode } from "react";

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

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
  // Hosts an uploaded certificate covers. Their routes keep usesAcme=false, so
  // without this they would be marked self-signed. Uploading or removing a
  // certificate invalidates it (features/certificates/data/certificates.ts).
  const { data: covered } = useQuery(
    orpc.project.proxyRoute.customCertHosts.queryOptions({ input: { projectId } }),
  );
  const customCertHosts = useMemo(() => new Set(covered ?? []), [covered]);
  const hosts = useMemo(
    () => selfSignedHosts(routes ?? [], customCertHosts),
    [routes, customCertHosts],
  );
  return (
    <SelfSignedHostsProvider hosts={hosts} customCertHosts={customCertHosts}>
      {children}
    </SelfSignedHostsProvider>
  );
}
