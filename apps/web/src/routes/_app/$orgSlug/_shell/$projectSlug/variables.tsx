/**
 * Variables. Infisical-style overview matrix + per-env table + bulk-edit
 * modal (with cross-env apply + drag-drop .env import + .env download).
 * Data wired to `orpc.project.envVar.{list,upsert,delete,bulkReplace}`.
 *
 * Tabs are dynamic: one per project environment (whatever slugs the org has
 * set up). External secret managers deliberately have NO surface here: they
 * are connected on the workspace Secrets page and consumed through
 * `${{vault.<provider>.<ref>}}` references, which the Add-Reference picker
 * already lists: a provider gallery on this page would duplicate that with
 * state it doesn't own. The matrix / per-env table / bulk editor each live
 * in `-components/`.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

import { BalanceScaleIcon } from "@hugeicons/core-free-icons";
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
import type { EnvironmentRef, EnvVarRow } from "./-components/variables-types";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/variables")({
  staticData: { crumb: "Variables" },
  component: VariablesRoute,
  // Warm the eager env collection on hover (intent-preload) so the tab renders
  // from cache instead of fetching on mount. Non-blocking + best-effort.
  // `variablesCollection` is syncMode "on-demand". Preload() is a no-op there
  // (it loads when a live query subscribes with its filters), so don't call it.
  loader: () => {
    void envCollection.preload();
  },
});

function VariablesRoute() {
  const { t } = useTranslation();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
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

  // Map<envId, EnvVarRow[]>. What each tab + the overview matrix render.
  // Populated by the per-env subscribers below; the on-demand
  // `variablesCollection` loads one (projectId, environmentId) subset each.
  const [byEnv, setByEnv] = useState<Map<string, EnvVarRow[]>>(new Map());
  const registerEnv = (envId: string, rows: EnvVarRow[]) => {
    setByEnv((prev) => {
      const next = new Map(prev);
      next.set(envId, rows);
      return next;
    });
  };

  // Union of every key seen in any env: the rows of the overview
  // matrix. Sorted alphabetically so the order matches the demo.
  const allKeys = (() => {
    const set = new Set<string>();
    for (const rows of byEnv.values()) {
      for (const r of rows) set.add(r.key);
    }
    return Array.from(set).sort();
  })();

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
            {t("nav.overview")}
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
        </TabsList>

        {/* One subscriber per env keeps `byEnv` in sync with the
            on-demand collection: each loads its own (projectId,
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
              projectSlug={project.slug}
              env={env}
              allEnvs={envRefs}
              rows={byEnv.get(env.id) ?? []}
            />
          </TabsContent>
        ))}
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
            eq(v.projectId, projectId),
            eq(v.environmentId, envId),
          ),
        ),
    [projectId, envId],
  );

  useEffect(() => {
    onRows(envId, rows);
  }, [envId, rows, onRows]);

  return null;
}
