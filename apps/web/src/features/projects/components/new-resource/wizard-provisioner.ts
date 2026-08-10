import type { Framework } from "@otterdeploy/shared/framework";
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { setPendingFramework } from "@/features/projects/components/graph/pending-framework-store";
import { orpc } from "@/shared/server/orpc";

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
  // HTTP health-check fields (Networking step). Empty path = no healthcheck.
  healthPath: string;
  healthInterval: number;
  healthTimeout: number;
  healthRetries: number;
  root: string;
  // Bound repo as portable "owner/repo" + its branch, threaded into the
  // manifest so the created service is actually bound. Undefined for image
  // sources (and for a git service the operator left unbound, apply then
  // surfaces the clear "no git repo binding" skip rather than silently
  // creating an unbuildable service).
  repo?: string;
  branch?: string;
  // Framework detected on the Source step (git.inspectRepo). Carried so the
  // ghost node can show its brand logo before the built resource lands with the
  // persisted value. Optional, undefined when nothing was detected.
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
    successToast: "Resource staged. Review and Apply.",
  });
  const navigate = useNavigate();

  // After a create stages, close the dialog and drop the operator on the
  // graph: that's where the new node lives (as a pending "ghost" until
  // applied) and where the pending-changes bar's Apply button sits.
  // Without this the wizard just closed in place and the resource appeared
  // "nowhere". useStageManifestChange owns the staged/failed toasts, so
  // this only handles routing.
  const finish = () => {
    onComplete?.();
    void navigate({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug, projectSlug },
    });
  };

  const runDatabaseCreate = async (payload: DatabaseCreatePayload) => {
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
  };

  const runServiceCreate = async (payload: ServiceCreatePayload) => {
    try {
      // Git-sourced services build with railpack straight into the swarm
      // node's docker daemon, no container registry required. A project
      // may still bind an external registry (for remote/multi-node pulls);
      // when it does, the builder pushes there, but it's never a gate on
      // creating the service.
      const seen = await orpc.project.manifest.get.call({ id: projectId });
      if (seen.manifest?.services[payload.name]) {
        toast.error(`Service "${payload.name}" already exists in the manifest.`);
        return;
      }
      // A public port row with no typed hostname publishes at the
      // server-derived FQDN (the same one the Networking/Review steps
      // previewed). Resolve it now so the staged manifest carries a real
      // `domains` seed, failing that, refuse to create rather than silently
      // shipping the "public" service internal-only.
      let derivedPublicHost: string | null = null;
      if (payload.ports.some((p) => p.public && p.port > 0 && p.host.trim() === "")) {
        try {
          const preview = await orpc.project.resource.publicHostPreview.call({
            projectId,
            name: payload.name,
          });
          derivedPublicHost = preview.fqdn;
        } catch {
          toast.error(
            "Couldn't resolve a public hostname for this service, so nothing was created. Type a hostname on the Networking step or turn Public off.",
          );
          return;
        }
      }
      await stage.mutateAsync((current) => ({
        ...current,
        project: current.project || projectSlug,
        services: {
          ...current.services,
          [payload.name]: buildServiceSpec({ ...payload, derivedPublicHost }),
        },
      }));
      // Seed the ghost node's brand logo from the framework the wizard already
      // detected: the manifest is framework-free, so this client hint carries
      // it until the real resource lands with its persisted value.
      if (payload.framework) {
        setPendingFramework(projectId, `service:${payload.name}`, payload.framework);
      }
      finish();
    } catch {
      // See runDatabaseCreate. Stage hook owns failure toasts.
    }
  };

  return { isCreating: stage.isPending, runDatabaseCreate, runServiceCreate };
}
