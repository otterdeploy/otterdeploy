import {
  customDirectiveUpstreams,
  upstreamEndpoint,
} from "@otterdeploy/shared/custom-directives-reach";
import { isForbiddenEgressAddress } from "@otterdeploy/shared/egress-policy";
import { canonicalHostname, dockerDnsName, isIpLiteral } from "@otterdeploy/shared/platform-hosts";
import { withTimeout } from "@otterdeploy/shared/promise";
import { Result, TaggedError } from "better-result";
import { lookup as systemDnsLookup } from "node:dns/promises";

/**
 * The project-aware half of the reach rules for raw route directives
 * . The write schema (packages/shared/src/custom-directives-reach.ts)
 * decides everything the text alone can: loopback, the admin API, sockets,
 * files, link-local, and the platform's own containers by name. What it cannot
 * decide without knowing the route is:
 *
 *  - whose service a Docker name is. The edge is attached to EVERY project
 *    network, so `od-other-api` reaches another tenant's service and a short
 *    alias (`api`, a resource name) resolves to whichever network answers
 *    first. A Docker name is accepted only when it is one of this project's
 *    own minted identities, the same identity a route's upstream is
 *    (route-validation.ts).
 *  - where an address points. An IP literal, or a public DNS name that
 *    resolves (now) to a private range, reaches the platform's networks by
 *    address instead of by name (`127.0.0.1.nip.io`, `10.0.3.7`). These go
 *    through the outbound egress policy the control plane uses for every
 *    tenant-supplied destination (packages/shared/src/egress-policy.ts): the
 *    same private-range denial, the same operator allowlist for LAN targets,
 *    and the same unconditional denial of the control plane's own addresses.
 *
 * DNS is resolved ONCE, at save time, with a bounded wait. It catches names
 * that point inward when saved; it cannot stop a name whose records change
 * afterwards (rebinding), because Caddy resolves again at request time. A
 * lookup that fails or times out is accepted: the edge, not this check, is
 * where an unresolvable upstream surfaces, and refusing on a slow resolver
 * would make saving flaky without closing the rebinding gap.
 */

/** The names a project's own workloads run as on the networks the edge shares. */
export interface ProjectUpstreamNames {
  /** Base swarm service / container names of the project's services and
   *  databases, plus its databases' `*.otterdeploy.internal` aliases and its
   *  routes' upstream hosts. */
  bases: ReadonlySet<string>;
  /** Environment slugs: a base runs as `<base>-<slug>` in that environment. */
  environments: ReadonlySet<string>;
}

/** Every address a host currently resolves to. */
export type HostLookup = (host: string) => Promise<string[]>;

export interface RouteDirectiveScope {
  own: ProjectUpstreamNames;
  /** Operator-approved LAN carve-outs (OTTERDEPLOY_EGRESS_ALLOWLIST). */
  allowAddresses: readonly string[];
  /** The control plane's own addresses and hostnames: never reachable. */
  denyAddresses: readonly string[];
  denyHosts: readonly string[];
  lookup: HostLookup;
  /** Defaults to DIRECTIVE_LOOKUP_TIMEOUT_MS. */
  lookupTimeoutMs?: number;
}

/** How long a save waits on DNS for one upstream name. */
export const DIRECTIVE_LOOKUP_TIMEOUT_MS = 2_000;

export class DirectiveReachError extends TaggedError("DirectiveReachError")<{
  message: string;
  upstream: string;
}>() {}

export async function systemHostLookup(host: string): Promise<string[]> {
  const answers = await systemDnsLookup(host, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/** Whether a Docker DNS name is one of the project's own workloads, in any
 *  environment or preview it runs in. */
function isOwnUpstreamName(own: ProjectUpstreamNames, name: string): boolean {
  if (own.bases.has(name)) return true;
  for (const base of own.bases) {
    if (!name.startsWith(`${base}-`)) continue;
    const scope = name.slice(base.length + 1);
    if (/^pr-\d+$/.test(scope) || own.environments.has(scope)) return true;
  }
  return false;
}

/** Every address `host` resolves to within the scope's wait, or none. */
async function resolvedAddresses(host: string, scope: RouteDirectiveScope): Promise<string[]> {
  const answers = await Result.tryPromise({
    try: () =>
      withTimeout(
        scope.lookup(host),
        scope.lookupTimeoutMs ?? DIRECTIVE_LOOKUP_TIMEOUT_MS,
        "directive upstream lookup",
      ),
    catch: (cause) => cause,
  });
  return answers.isOk() ? answers.value : [];
}

function forbiddenAddress(addresses: readonly string[], scope: RouteDirectiveScope) {
  return addresses.find((address) =>
    isForbiddenEgressAddress(address, {
      allowAddresses: scope.allowAddresses,
      denyAddresses: scope.denyAddresses,
    }),
  );
}

const ADDRESS_HINT =
  "route directives can only reach your own services by name and public addresses. An installation administrator can open specific LAN addresses with the egress allowlist (Settings, Instance).";

/** The most distinct public hostnames one save resolves. Lookups run
 *  concurrently, so a save waits about one DIRECTIVE_LOOKUP_TIMEOUT_MS at
 *  worst; the cap keeps a 16KB block from fanning out into hundreds of
 *  queries. */
export const MAX_DIRECTIVE_LOOKUPS = 16;

/** One dialed address, split into what can be judged now and the public
 *  hostname (if any) that still needs DNS. */
interface UpstreamVerdict {
  error: string | null;
  lookup: string | null;
}

/** Why one dialed address is out of this route's reach without DNS, or the
 *  public hostname that has to be resolved to tell. */
function upstreamVerdict(upstream: string, scope: RouteDirectiveScope): UpstreamVerdict {
  const { network, host } = upstreamEndpoint(upstream);
  // Sockets and empty hosts were already refused by the write schema.
  if (network?.startsWith("unix") || host === "") return { error: null, lookup: null };
  const quoted = JSON.stringify(upstream);
  const bare = canonicalHostname(host).replace(/^\[|\]$/g, "");

  if (scope.denyHosts.includes(bare)) {
    return {
      error: `Upstream ${quoted} is this control plane's own address: route directives cannot reach it.`,
      lookup: null,
    };
  }
  const dockerName = dockerDnsName(host);
  if (dockerName !== null) {
    return {
      error: isOwnUpstreamName(scope.own, dockerName)
        ? null
        : `Upstream ${quoted} is not one of this project's services. The edge shares a network with every project, so a short alias or another project's service name is ambiguous or someone else's: proxy to your service's own name (od-<project>-<service>).`,
      lookup: null,
    };
  }
  if (isIpLiteral(host)) {
    return {
      error:
        forbiddenAddress([bare], scope) === undefined
          ? null
          : `Upstream ${quoted} is a private or internal address: ${ADDRESS_HINT}`,
      lookup: null,
    };
  }
  return { error: null, lookup: bare };
}

function createReachError(message: string, upstream: string) {
  return Result.err(new DirectiveReachError({ message, upstream }));
}

/**
 * Validate raw directive text against the route it is saved on. The text has
 * already passed the write schema; this adds the rules that need the project
 * and the network (see the module comment).
 */
export async function parseRouteDirectives(
  text: string,
  scope: RouteDirectiveScope,
): Promise<Result<string, DirectiveReachError>> {
  // Public hostname -> the first upstream that named it, for the message.
  const pending = new Map<string, string>();
  for (const upstream of new Set(customDirectiveUpstreams(text))) {
    const verdict = upstreamVerdict(upstream, scope);
    if (verdict.error !== null) return createReachError(verdict.error, upstream);
    if (verdict.lookup !== null && !pending.has(verdict.lookup)) {
      pending.set(verdict.lookup, upstream);
    }
  }
  if (pending.size > MAX_DIRECTIVE_LOOKUPS) {
    const [, upstream = ""] = [...pending][MAX_DIRECTIVE_LOOKUPS] ?? [];
    return createReachError(
      `Route directives can name at most ${MAX_DIRECTIVE_LOOKUPS} distinct public upstream hostnames; this block names ${pending.size}.`,
      upstream,
    );
  }
  const resolved = await Promise.all(
    [...pending].map(async ([host, upstream]) => ({
      upstream,
      inward: forbiddenAddress(await resolvedAddresses(host, scope), scope),
    })),
  );
  for (const { upstream, inward } of resolved) {
    if (inward !== undefined) {
      return createReachError(
        `Upstream ${JSON.stringify(upstream)} resolves to ${inward}, a private or internal address: ${ADDRESS_HINT}`,
        upstream,
      );
    }
  }
  return Result.ok(text);
}
