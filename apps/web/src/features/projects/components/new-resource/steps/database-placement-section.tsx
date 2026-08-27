/**
 * Where a database RUNS: in a container of its own, or inside a server that is
 * already running.
 *
 * The decision this section exists to inform is not "does a server exist" but
 * "is there room on one", so every server row carries what actually answers
 * that: the live connection budget and the databases already sharing it. A
 * server that could not be probed says so rather than rendering a confident
 * zero — an unreachable server is exactly the one you must not put a database
 * on, and a card reading "0 of 0 used" invites the opposite conclusion.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { CheckmarkCircle02Icon, DatabaseIcon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import {
  builderCardActiveClass,
  builderCardClass,
  builderIconClass,
  SectionHeader,
} from "../form-primitives";

/** Engines with a real per-database user + grant model. Redis shares one
 *  password across its numbered databases, so it has nothing to isolate. */
const HOSTABLE = new Set(["postgres", "mariadb", "mongodb"]);

export function DatabasePlacementSection({
  engine,
  projectId,
}: {
  engine: string;
  projectId: ProjectId;
}) {
  const form = useFormContext();
  const hostName = useSelector(form.store, (s) => s.values.hostName);

  const hostable = HOSTABLE.has(engine);
  const hosts = useQuery({
    ...orpc.database.listHosts.queryOptions({
      input: { engine: hostable ? asHostEngine(engine) : "postgres" },
    }),
    enabled: hostable,
  });

  if (!hostable) return null;
  // Org-wide, because sharing one engine across several small projects is the
  // whole point — but this project's own servers come first, since that is
  // where the operator's attention already is.
  const servers = [...(hosts.data?.hosts ?? [])].sort((a, b) => {
    const mine = Number(b.projectId === projectId) - Number(a.projectId === projectId);
    return mine !== 0 ? mine : a.name.localeCompare(b.name);
  });
  // Nothing to choose between yet. Rendering an empty picker would read as a
  // broken control; the dedicated container is simply what happens.
  if (!hosts.isLoading && servers.length === 0) return null;

  return (
    <>
      <SectionHeader
        title="Where it runs"
        sub="A shared server saves a whole engine process per database. It also means one restart, one machine and one connection budget for everything on it."
      />
      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            form.setFieldValue("hostName", null);
            form.setFieldValue("connectionLimit", null);
          }}
          className={cn(builderCardClass, hostName === null && builderCardActiveClass)}
        >
          <div className="flex items-center gap-2">
            <div className={builderIconClass}>
              <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} className="size-3.5" />
            </div>
            <span className="text-sm font-semibold">Its own container</span>
            {hostName === null && (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className="ml-auto size-4 text-success"
              />
            )}
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Its own volume, restarts and machine pin. The default, and the only option if you need
            to branch it into previews with ZFS.
          </div>
        </button>
      </div>

      <Card className="mt-2.5 rounded-md">
        <CardContent className="p-0">
          {servers.map((server) => {
            const selected = hostName === server.name;
            return (
              <button
                key={server.resourceId}
                type="button"
                disabled={!server.running}
                onClick={() => form.setFieldValue("hostName", server.name)}
                className={cn(
                  "flex w-full items-center gap-3 border-t px-3 py-2.5 text-left first:border-t-0",
                  "disabled:cursor-not-allowed disabled:opacity-55",
                  selected && "bg-accent/40",
                )}
              >
                <div className={builderIconClass}>
                  <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="truncate">{server.name}</span>
                    <span className="truncate text-[11px] font-normal text-muted-foreground">
                      {server.projectName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {describeServer(server)}
                  </div>
                </div>
                {selected && (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    strokeWidth={2}
                    className="size-4 shrink-0 text-success"
                  />
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}

/** The one line that decides the choice: how loaded the server is, and what is
 *  already on it. Deliberately says "couldn't reach" instead of rendering
 *  zeros for a server that didn't answer. */
function describeServer(server: {
  running: boolean;
  connections: { used: number; max: number } | null;
  tenants: unknown[];
}): string {
  const tenants =
    server.tenants.length === 0
      ? "no databases yet"
      : `${server.tenants.length} database${server.tenants.length === 1 ? "" : "s"}`;
  if (!server.running) return `Not running — ${tenants}`;
  if (!server.connections) return `Couldn't read its connection use — ${tenants}`;
  return `${server.connections.used} of ${server.connections.max} connections used — ${tenants}`;
}

/** Narrow the wizard's free-form kind id to the three engines the endpoint
 *  accepts. Guarded by HOSTABLE at the only call site. */
function asHostEngine(engine: string): "postgres" | "mariadb" | "mongodb" {
  if (engine === "mariadb") return "mariadb";
  if (engine === "mongodb") return "mongodb";
  return "postgres";
}
