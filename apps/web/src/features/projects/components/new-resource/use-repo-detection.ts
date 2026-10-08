/**
 * Read-only detection hints for the step views. What `git.inspectRepo` found
 * for the currently bound (repo, root): the framework and the Dockerfile, and
 * the builder / port defaults that follow from them (see build-defaults.ts).
 * Steps use these to *explain* a prefilled value ("Port 80 prefilled from
 * EXPOSE in /Dockerfile"), never to set one.
 *
 * Applying detection to the form is a separate job and lives in
 * `steps/source-defaults.ts`, driven by the `repo`/`root` field listeners.
 * Keep it that way: a hook that both reads a query and writes the fields that
 * query is keyed on is the shape that produced the effects it replaced.
 */

import { useSelector } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { RepoDetection } from "./build-defaults";

import { useFormContext } from "./form-context";

function useInspectQuery(repo: string, root: string): RepoDetection {
  // Same query (and key) as the Builder step's DetectionBanner and the root
  // directory picker: react-query dedupes, so this adds no network cost.
  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const framework = inspect.data?.framework ?? null;
  const dockerfile = inspect.data?.dockerfile ?? null;
  return { framework, dockerfile };
}

/** Step-view accessor (needs a mounted form context), for detection hints. */
export function useRepoDetection(): RepoDetection {
  const form = useFormContext();
  const repo = useSelector(form.store, (s) => s.values.repo);
  const root = useSelector(form.store, (s) => s.values.root);
  return useInspectQuery(repo, root);
}
