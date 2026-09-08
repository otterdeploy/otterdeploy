/**
 * The overlay network a project's resources attach to.
 *
 * Named per project AND per environment, because the network is a DNS
 * namespace: everything on it resolves everything else by hostname. A network
 * keyed on the project alone put every environment's containers on one
 * namespace, so a production service could resolve — and connect to — a
 * staging database, purely by asking for its hostname. Observed in the wild: a
 * production API reading `postgres-staging.<project>.otterdeploy.internal`,
 * answered on the shared network, with live traffic against the wrong data.
 *
 * Name-scoping alone does not prevent that. It makes the two hostnames
 * distinct, which stops an accidental collision, but any code (or operator)
 * that names the other environment's host still reaches it. A separate network
 * makes it unresolvable, which is the property an environment boundary is
 * supposed to have.
 *
 * The MAIN environment renders as base (`scopeSuffix` returns "" for it), so
 * every already-deployed project keeps the exact network it has and nothing
 * needs migrating. Only additional environments take a suffix, and they get a
 * network of their own the first time they deploy. See
 * lib/environment/scoping.ts for why main is identity.
 */
import { PLATFORM } from "../constants";

/**
 * @param projectSlug canonical project slug
 * @param scopeSuffix `scopeSuffix(scope)` — "" for base/main, `-<env>` for an
 *        additional environment, `-pr-<n>` for a preview. Defaults to base so
 *        a caller that has no scope keeps today's name.
 */
export function projectNetworkName(projectSlug: string, scopeSuffix = ""): string {
  return `${PLATFORM.swarm.networkPrefix}${projectSlug}${scopeSuffix}`;
}
