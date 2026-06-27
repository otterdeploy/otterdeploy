/**
 * Variables — Infisical-style overview matrix + per-env table + bulk-edit
 * modal + sync integrations. Data wired to
 * `orpc.project.envVar.{list,upsert,delete,bulkReplace}`.
 *
 * Tabs are dynamic — one per project environment (whatever slugs the org has
 * set up). The Sync tab still renders a static provider list — the sync-source
 * backend is a separate Plan 7 follow-up. The matrix / per-env table / bulk
 * editor / sync UI each live in `-components/`.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BalanceScaleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { envCollection } from "@/features/projects/data/env";
import { variablesCollection } from "@/features/projects/data/variables";
import { Badge } from "@/shared/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

import { OverviewMatrix } from "./-components/variables-overview";
import { PerEnvTable } from "./-components/variables-table";
import { SyncIntegrations } from "./-components/variables-sync";
import type { EnvironmentRef, EnvVarRow } from "./-components/variables-types";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/variables")({
  staticData: { crumb: "Variables" },
  component: VariablesRoute,
});

function VariablesRoute() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const projectId = project.id;

  // All envs for this project, slug-sorted so the tab order is stable
  // across renders (the collection isn't intrinsically ordered).
  const { data: environments } = useLiveQuery(
    (q) =>
      q
        .from({ e: envCollection })
        .where(({ e }) => eq(e.projectId, projectId))
        .orderBy(({ e }) => e.slug),
    [projectId],
  );

  // Map<envId, EnvVarRow[]> — what each tab + the overview matrix render.
  // Populated by the per-env subscribers below; the on-demand
  // `variablesCollection` loads one (projectId, environmentId) subset each.
  const [byEnv, setByEnv] = useState<Map<string, EnvVarRow[]>>(new Map());
  const registerEnv = useCallback((envId: string, rows: EnvVarRow[]) => {
    setByEnv((prev) => {
      const next = new Map(prev);
      next.set(envId, rows);
      return next;
    });
  }, []);

  // Union of every key seen in any env — the rows of the overview
  // matrix. Sorted alphabetically so the order matches the demo.
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    for (const rows of byEnv.values()) {
      for (const r of rows) set.add(r.key);
    }
    return Array.from(set).sort();
  }, [byEnv]);

  const envRefs: EnvironmentRef[] = environments.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
  }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="overview" className="flex flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="h-10 w-full justify-start gap-1 px-4"
        >
          <TabsTrigger value="overview" className="gap-1.5">
            <HugeiconsIcon icon={BalanceScaleIcon} className="size-3.5" />
            Overview
          </TabsTrigger>
          {envRefs.map((env) => {
            const count = byEnv.get(env.id)?.length ?? 0;
            return (
              <TabsTrigger key={env.id} value={env.id} className="gap-1.5 capitalize">
                {env.name || env.slug}
                {count > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 rounded-sm px-1.5 font-mono text-[10px]">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="sync" className="gap-1.5">
            <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" />
            Sync
          </TabsTrigger>
        </TabsList>

        {/* One subscriber per env keeps `byEnv` in sync with the
            on-demand collection — each loads its own (projectId,
            environmentId) subset. Headless: renders nothing. */}
        {envRefs.map((env) => (
          <EnvVarsSubscriber
            key={env.id}
            projectId={projectId}
            envId={env.id}
            onRows={registerEnv}
          />
        ))}

        <TabsContent value="overview" className="flex-1 overflow-auto">
          <OverviewMatrix envs={envRefs} byEnv={byEnv} allKeys={allKeys} />
        </TabsContent>
        {envRefs.map((env) => (
          <TabsContent key={env.id} value={env.id} className="flex-1 overflow-auto">
            <PerEnvTable
              projectId={projectId}
              env={env}
              rows={byEnv.get(env.id) ?? []}
            />
          </TabsContent>
        ))}
        <TabsContent value="sync" className="flex-1 overflow-auto">
          <SyncIntegrations />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Subscribes to one env's vars via the on-demand `variablesCollection`
 * (scoped by projectId + environmentId) and lifts the rows into the
 * parent's `byEnv` map. Renders nothing.
 */
function EnvVarsSubscriber({
  projectId,
  envId,
  onRows,
}: {
  projectId: string;
  envId: string;
  onRows: (envId: string, rows: EnvVarRow[]) => void;
}) {
  const { data: rows } = useLiveQuery(
    (q) =>
      q
        .from({ v: variablesCollection })
        .where(({ v }) =>
          and(
            eq(v.projectId, projectId as never),
            eq(v.environmentId, envId as never),
          ),
        ),
    [projectId, envId],
  );

  useEffect(() => {
    onRows(envId, rows);
  }, [envId, rows, onRows]);

  return null;
}
