/**
 * Pause / resume one published host without deleting it (the operator's
 * per-domain off switch). Split out of ./domains, which is at its line cap
 * and stays about the add/update/recheck/remove lifecycle.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";
import type { ServiceNotFoundError } from "./errors";
import type { ResourceRef } from "./inputs";

import { queueReloadOf } from "../../caddy/edge-sync";
import { updateProxyRoute } from "../../caddy/queries";
import { loadDomainView, serverIpFor, type ServiceDomainView } from "./domain-rules";
import { loadOwnedRoute } from "./domains";
import { DomainNotFoundError } from "./errors";

/** Writes `disabledByUser` rather than the system-owned `enabled` gate, so
 *  cert settings and verification state survive and expose/recheck can't
 *  overturn the choice. */
export async function setServiceDomainEnabled(
  input: ResourceRef & { routeId: ProxyRouteId; enabled: boolean },
  log: RequestLogger,
): Promise<
  Result<ServiceDomainView, ProjectNotFoundError | ServiceNotFoundError | DomainNotFoundError>
> {
  const owned = await loadOwnedRoute(input);
  if (owned.isErr()) return Result.err(owned.error);
  const { route } = owned.value;

  const written = await updateProxyRoute(input.routeId, { disabledByUser: !input.enabled });
  if (!written) return Result.err(new DomainNotFoundError({ routeId: input.routeId }));

  // Re-render so the host drops out of (or returns to) Caddy. Queued, not
  // awaited: the row says pending until the reload settles it.
  const updated = await queueReloadOf(written);
  log.set({
    domain: { action: input.enabled ? "resume" : "pause", domain: route.domain },
  });
  return Result.ok(await loadDomainView(updated, await serverIpFor(input), input.organizationId));
}
