import type { Framework } from "@otterdeploy/shared/framework";
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useCallback, useEffect } from "react";

import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { setPendingFramework } from "@/features/projects/components/graph/pending-framework-store";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { Port } from "./form-fields/ports-field";
import type { Var } from "./form-fields/variables-field";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { buildDatabaseSpec, buildServiceSpec } from "./to-manifest";

export interface DatabaseCreatePayload {
  engine: "postgres" | "redis" | "mariadb" | "mongodb";
  name: string;
  publicEnabled: boolean;
  extensions: string[];
  version: string | null;
  presetId: string;
  customCpu: number;
  customMem: number;
}

export interface ServiceCreatePayload {
  name: string;
  source: "image" | "git";
  kindId: string;
  image: string;
  ports: Port[];
  variables: Var[];
  replicas: number;
  presetId: string;
  customCpu: number;
  customMem: number;
  builderId: string;
  spa: boolean;
  root: string;
  // Framework detected on the Source step (git.inspectRepo). Carried so the
  // ghost node can show its brand logo before the built resource lands with the
  // persisted value. Optional — undefined when nothing was detected.
  framework?: Framework | null;
}

/**
 * Owns the two create mutators (database / service) that the wizard's
 * `onSubmit` dispatches to. Both mutators stage into the project
 * manifest; the pending-changes bar surfaces the change and the
 * operator clicks Deploy to reconcile. `isCreating` mirrors the
 * underlying mutation's pending state so the footer can disable the
 * submit button while the save is in flight.
 */
export function useResourceProvisioner({
  projectId,
  orgSlug,
  projectSlug,
  onComplete,
}: {
  projectId: ProjectId;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onComplete?: () => void;
}) {
  const stage = useStageManifestChange(projectId, {
    successToast: "Resource staged — review and click Deploy to apply",
  });
  const navigate = useNavigate();

  // After a create stages, close the dialog and drop the operator on the
  // graph — that's where the new node lives (as a pending "ghost" until
  // deployed) and where the pending-changes bar's Deploy button sits.
  // Without this the wizard just closed in place and the resource appeared
  // "nowhere". useStageManifestChange owns the staged/failed toasts, so
  // this only handles routing.
  const finish = useCallback(() => {
    onComplete?.();
    void navigate({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug, projectSlug },
    });
  }, [navigate, onComplete, orgSlug, projectSlug]);

  const runDatabaseCreate = useCallback(
    async (payload: DatabaseCreatePayload) => {
      try {
        const seen = await orpc.project.manifest.get.call({ id: projectId });
        if (seen.manifest?.databases[payload.name]) {
          toast.error(`Database "${payload.name}" already exists in the manifest.`);
          return;
        }
        await stage.mutateAsync((current) => ({
          ...current,
          project: current.project || projectSlug,
          databases: {
            ...current.databases,
            [payload.name]: buildDatabaseSpec(payload),
          },
        }));
        finish();
      } catch {
        // Network/version-conflict errors are toasted by the stage hook;
        // keep the dialog open so the operator can adjust and retry.
      }
    },
    [projectId, projectSlug, stage, finish],
  );

  const runServiceCreate = useCallback(
    async (payload: ServiceCreatePayload) => {
      try {
        // Git-sourced services build with railpack straight into the swarm
        // node's docker daemon — no container registry required. A project
        // may still bind an external registry (for remote/multi-node pulls);
        // when it does, the builder pushes there, but it's never a gate on
        // creating the service.
        const seen = await orpc.project.manifest.get.call({ id: projectId });
        if (seen.manifest?.services[payload.name]) {
          toast.error(`Service "${payload.name}" already exists in the manifest.`);
          return;
        }
        await stage.mutateAsync((current) => ({
          ...current,
          project: current.project || projectSlug,
          services: {
            ...current.services,
            [payload.name]: buildServiceSpec(payload),
          },
        }));
        // Seed the ghost node's brand logo from the framework the wizard already
        // detected — the manifest is framework-free, so this client hint carries
        // it until the real resource lands with its persisted value.
        if (payload.framework) {
          setPendingFramework(projectId, `service:${payload.name}`, payload.framework);
        }
        finish();
      } catch {
        // See runDatabaseCreate — stage hook owns failure toasts.
      }
    },
    [projectId, projectSlug, stage, finish],
  );

  return { isCreating: stage.isPending, runDatabaseCreate, runServiceCreate };
}

/**
 * Warm the caches the source step depends on so the dropdown +
 * Root Directory picker have data the instant the operator gets to
 * the source step instead of waterfalling three queries on arrival.
 *
 *   - git.list          → providers + installations + repoCount
 *   - git.listRepos     → repos for the active installation (used by
 *                         the repo dropdown + the bound-repo fullName
 *                         lookup)
 *   - git.inspectRepo   → root listing for the currently-bound repo;
 *                         the server caches the full tree on this
 *                         first call so subsequent navigations are
 *                         free.
 *
 * Prefetches fan out in parallel; each is no-op when the data is
 * already cached, so the cost of an extra wizard mount is zero.
 */
export function usePrefetchSourceData(initialGitRepoId: string | null) {
  useEffect(() => {
    const run = async () => {
      const providersOptions = orpc.git.list.queryOptions();
      await queryClient.prefetchQuery(providersOptions);
      const providers = queryClient.getQueryData(providersOptions.queryKey) ?? [];
      const installations = providers.flatMap((p) => p.installations);
      const active = installations[0];
      if (!active) return;

      await Promise.all([
        queryClient.prefetchQuery(
          orpc.git.listRepos.queryOptions({
            input: { installationId: active.id },
          }),
        ),
        initialGitRepoId
          ? queryClient.prefetchQuery({
              ...orpc.git.inspectRepo.queryOptions({
                input: {
                  // The route loader hands us a plain string; the
                  // inspect input wants the branded GitRepoId. Cast
                  // through `as never` so the unique-symbol brand is
                  // satisfied without dragging the brand type into
                  // this file.
                  gitRepoId: initialGitRepoId,
                  path: "",
                },
              }),
              staleTime: 5 * 60 * 1000,
            })
          : Promise.resolve(),
      ]);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGitRepoId]);
}
