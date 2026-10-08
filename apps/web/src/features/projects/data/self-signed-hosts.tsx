/**
 * Which of a project's public hosts the edge serves with a self-signed
 * certificate.
 *
 * Most surfaces that offer a public URL (the graph's Visit pill, the service
 * panel header, a stack's Exposed services, a deployment's address line) only
 * hold the bare hostname. They used to hand it over as if it would open, and
 * for a generated sslip.io host it does not: the route is on `tls internal`, so
 * a browser stops on ERR_CERT_AUTHORITY_INVALID before the site loads.
 *
 * The fact lives on the route row (`proxy_route.uses_acme`, the decision the
 * reconciler wrote into the Caddyfile), not in the hostname, so the project
 * layout reads the project's routes once (./project-self-signed-hosts) and
 * this answers "is this host self-signed" for anything below it. The routes collection is kept live by
 * the project event stream, so a host that earns a real certificate stops
 * being marked without a reload.
 *
 * Outside a provider (tests, surfaces with no project) every answer is "no":
 * an absent mark only withholds a warning, it never invents one.
 */

import { createContext, useContext, type ReactNode } from "react";

/** The route fields the decision reads. */
export interface RouteCertFacts {
  domain: string;
  type: "http" | "layer4";
  enabled: boolean;
  disabledByUser: boolean;
  usesAcme: boolean;
}

/** Hosts a browser would reach and find a self-signed certificate on: HTTP
 *  routes the edge is serving right now that did not earn ACME. A paused or
 *  system-disabled route serves nothing, so it has no certificate to warn
 *  about. */
export function selfSignedHosts(routes: readonly RouteCertFacts[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of routes) {
    if (r.type !== "http" || !r.enabled || r.disabledByUser || r.usesAcme) continue;
    out.add(r.domain.toLowerCase());
  }
  return out;
}

const EMPTY: ReadonlySet<string> = new Set();

const SelfSignedHostsContext = createContext<ReadonlySet<string>>(EMPTY);

/** Supplies an already-computed set. The seam tests use; the app mounts
 *  ProjectSelfSignedHosts (./project-self-signed-hosts), which computes it
 *  from the live routes collection. Kept apart so a component that only reads
 *  the answer does not pull the persisted collection into its import graph. */
export function SelfSignedHostsProvider({
  hosts,
  children,
}: {
  hosts: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <SelfSignedHostsContext.Provider value={hosts}>{children}</SelfSignedHostsContext.Provider>
  );
}

/** Is this host (bare, or a full URL) served with a self-signed certificate? */
export function useIsSelfSigned(host: string | null | undefined): boolean {
  const hosts = useContext(SelfSignedHostsContext);
  if (!host) return false;
  const bare = host
    .replace(/^https?:\/\//, "")
    .replace(/[/:].*$/, "")
    .toLowerCase();
  return hosts.has(bare);
}
