/**
 * Detects the framework for every git-bound service in the project and
 * exposes a `Map<resourceId, FrameworkKind>` for the graph layout to
 * merge into node data.
 *
 * Strategy: one `git.inspectRepo` query per service, keyed on
 * (gitRepoId, sourceSubdir). React Query buckets the cache, so two
 * services that share a repo + path only fire one request between them.
 *
 * The hook is a no-op when:
 *   - the project has no gitRepoId bound, or
 *   - there are no `source === "git"` services
 *
 * Pending-create nodes don't get framework yet — we'd need the manifest
 * stage to surface the staged service's source binding to the client
 * first. Existing services covered.
 */

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";
import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";
import { orpc } from "@/shared/server/orpc";

interface GitRef {
  resourceId: string;
  gitRepoId: string;
  path: string;
}

export function useServiceFrameworks(
  projectGitRepoId: string | null,
  resources: ProjectResource[],
): Map<string, FrameworkKind> {
  const refs: GitRef[] = useMemo(() => {
    if (!projectGitRepoId) return [];
    return resources.flatMap((r) =>
      r.type === "service" && r.source === "git"
        ? [
            {
              resourceId: r.resourceId,
              gitRepoId: projectGitRepoId,
              path: r.sourceSubdir ?? "",
            },
          ]
        : [],
    );
  }, [projectGitRepoId, resources]);

  const inspectQueries = useQueries({
    queries: refs.map((ref) => ({
      ...orpc.git.inspectRepo.queryOptions({
        input: { gitRepoId: ref.gitRepoId as never, path: ref.path },
      }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  return useMemo(() => {
    const out = new Map<string, FrameworkKind>();
    refs.forEach((ref, i) => {
      const fw = inspectQueries[i]?.data?.framework;
      if (fw) out.set(ref.resourceId, fw as FrameworkKind);
    });
    return out;
  }, [refs, inspectQueries]);
}
