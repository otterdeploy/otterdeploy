/**
 * Edge-logs tail plumbing — the org host-scope resolver plus the abortable
 * async generators that bridge the in-memory rings' pub/sub into the tail
 * procedures. Split out of index.ts, which keeps the router handlers.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import {
  type EdgeEventLine,
  type EdgeLogLine,
  eventHosts,
  subscribeEdgeEvents,
  subscribeEdgeLogs,
} from "../../edge-logs";
import { listOrgDomains, listProjectDomains } from "./queries";

/** Resolve the access-log host scope: a project's domains when projectId is
 *  given (org-verified), otherwise all the org's domains. */
export async function resolveHosts(
  organizationId: Parameters<typeof listOrgDomains>[0],
  projectId: string | undefined,
): Promise<string[]> {
  return projectId
    ? listProjectDomains(organizationId, projectId as ProjectId)
    : listOrgDomains(organizationId);
}

/** Bridge the ring's pub/sub into an abortable async generator with a small
 *  backpressure queue. Only the org's own hosts (optionally one) pass. */
export async function* streamEdgeLogs(
  hosts: Set<string>,
  hostFilter: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<EdgeLogLine> {
  const queue: EdgeLogLine[] = [];
  let wake: (() => void) | null = null;

  const unsub = subscribeEdgeLogs((line) => {
    if (!hosts.has(line.host)) return;
    if (hostFilter && line.host !== hostFilter) return;
    queue.push(line);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      const line = queue.shift();
      if (line === undefined) continue;
      yield line;
    }
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Operational-event tail: bridge the event ring's pub/sub, scoped to the
 *  caller's hosts. An event passes if any host it's attributable to (its host
 *  or a batch domain) is in scope; batch `domains` are redacted to the owned
 *  subset so a box-wide cert line only shows this tenant's domains. */
export async function* streamEdgeEvents(
  hosts: Set<string>,
  hostFilter: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<EdgeEventLine> {
  const queue: EdgeEventLine[] = [];
  let wake: (() => void) | null = null;

  const unsub = subscribeEdgeEvents((line) => {
    const attributable = eventHosts(line);
    if (!attributable.some((h) => hosts.has(h))) return;
    if (hostFilter && !attributable.includes(hostFilter)) return;
    const owned = line.domains.filter((d) => hosts.has(d));
    queue.push(
      line.domains.length && owned.length !== line.domains.length
        ? { ...line, domains: owned }
        : line,
    );
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      const line = queue.shift();
      if (line === undefined) continue;
      yield line;
    }
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
  }
}
