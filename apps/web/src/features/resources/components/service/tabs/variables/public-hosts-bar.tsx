/**
 * Which host this service's address tokens resolve to.
 *
 * A service can serve many domains, but `DOMAIN` and `PUBLIC_URL` export
 * exactly one of them — the PRIMARY (see packages/api/src/lib/variables/
 * exporters.ts). Promoting a different route therefore rewrites the address
 * every dependent resolves, which is why `setPrimaryServiceDomain` republishes
 * them and a redeploy is still needed.
 *
 * None of that was visible from the Variables tab: you could read
 * `${{stack.web.PUBLIC_URL}}` in a value with no way to know which of three
 * hosts it meant, or that changing the primary elsewhere would silently move
 * it. This bar is the legend for every reference below it.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

/** Tokens whose value follows the primary host. `DOMAINS` deliberately isn't
 *  one: it lists every host, so promoting a different primary only reorders
 *  it. */
const FOLLOWS_PRIMARY = /\$\{\{[^}]*\.(PUBLIC_URL|DOMAIN)\}\}/;

export function countPrimaryDependents(env: Record<string, string> | undefined): number {
  return Object.values(env ?? {}).filter((v) => FOLLOWS_PRIMARY.test(v)).length;
}

export function PublicHostsBar({
  projectId,
  resourceId,
  dependents,
}: {
  projectId: ProjectId;
  resourceId: ResourceId;
  /** How many of THIS service's own values point at a primary-following
   *  token. Counted by the tab, which already holds the env. */
  dependents: number;
}) {
  const domains = useQuery(
    orpc.service.domains.list.queryOptions({ input: { projectId, resourceId } }),
  );
  const rows = domains.data ?? [];
  // One host is no ambiguity to resolve, and none means the tokens don't
  // exist at all — the exporter omits them rather than emitting blanks.
  if (rows.length < 2) return null;

  const primary = rows.find((d) => d.isPrimary) ?? rows[0];
  if (!primary) return null;

  return (
    <div className="rounded-lg border border-border/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase">
          Public hosts
        </span>
        {rows.map((d) => (
          <span
            key={d.id}
            title={
              d.isPrimary
                ? "Primary — DOMAIN and PUBLIC_URL resolve here"
                : "Not primary. Promote it in Settings › Networking."
            }
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11.5px]",
              d.isPrimary
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {d.isPrimary && <span className="text-[9px] text-primary">★</span>}
            {d.domain}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <span className="font-mono">PUBLIC_URL</span> and <span className="font-mono">DOMAIN</span>{" "}
        resolve to the primary (<span className="font-mono">{primary.domain}</span>);{" "}
        <span className="font-mono">DOMAINS</span> gives all {rows.length}, comma-joined.
        {dependents > 0 && (
          <>
            {" "}
            <span className="text-warning">
              {dependents} variable{dependents === 1 ? "" : "s"} here point at it
            </span>{" "}
            — promoting another host changes what they resolve to, and needs a redeploy.
          </>
        )}
      </p>
    </div>
  );
}
