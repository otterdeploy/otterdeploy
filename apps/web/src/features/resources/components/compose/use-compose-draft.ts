import { idSchema } from "@otterdeploy/shared/id";
/**
 * The staged half of the compose panel: what a stack shows and does before it
 * has ever deployed.
 *
 * Split out of panel.tsx to keep that file under its caps, but the split is
 * also the point. A draft used to be expressed as one boolean (`pending`) fed
 * straight into the redeploy state, which is how a stack that had never
 * deployed ended up rendering a disabled "Redeploying…" spinner over an empty
 * service list. Draft behaviour lives here, on its own terms:
 *
 *   - services come from parsing the STAGED compose, not from child rows that
 *     do not exist yet;
 *   - the action is Deploy, and it reconciles through the project's manifest
 *     apply — the same path the pending-changes bar's Deploy uses.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

import type { ComposeService } from "./panel-parts";

export function useComposeDraft({
  pending,
  projectId,
  name,
  composeContent,
  liveServices,
}: {
  /** Staged create: no resource row exists yet. */
  pending: boolean;
  projectId: string;
  name: string;
  /** Staged compose YAML; null for a git stack with nothing cloned yet. */
  composeContent: string | null;
  /** The real, materialized services, used whenever this is not a draft. */
  liveServices: ComposeService[];
}) {
  // Stateless parse, the same endpoint the create wizard's preview uses. It
  // never touches the DB, and a draft has no resourceId to fetch services by.
  const preview = useQuery({
    ...orpc.compose.parse.queryOptions({
      input: { projectId: idSchema.project.parse(projectId), content: composeContent ?? "" },
    }),
    enabled: pending && composeContent !== null && composeContent.length > 0,
  });

  const services: ComposeService[] = pending
    ? (preview.data?.services ?? []).map((svc) => ({
        name: svc.name,
        // Nothing materialized to join to while staged, so the runtime name is
        // unused here and the compose key is the honest stand-in.
        serviceName: svc.name,
        image: svc.image,
        hasBuild: svc.hasBuild,
        ports: svc.ports,
        volumes: svc.volumes,
      }))
    : liveServices;

  const apply = useMutation({
    mutationFn: () =>
      orpc.project.manifest.apply.call({ projectId: idSchema.project.parse(projectId) }),
    onSuccess: () =>
      toast.success(`Deploying ${name}`, {
        description: "Applying this project's staged changes.",
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to deploy"),
  });

  return { services, apply, parsing: preview.isLoading };
}
