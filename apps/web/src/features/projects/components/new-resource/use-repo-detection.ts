/**
 * Read-only detection hints for the step views. The framework
 * `git.inspectRepo` found for the currently bound (repo, root), and the
 * conventional port that goes with it. Steps use these to *explain* a
 * prefilled value ("Detected Vite, port 5173 prefilled"), never to set one.
 *
 * Applying detection to the form is a separate job and lives in
 * `steps/source-defaults.ts`, driven by the `repo`/`root` field listeners.
 * Keep it that way: a hook that both reads a query and writes the fields that
 * query is keyed on is the shape that produced the effects it replaced.
 */

import { frameworkDefaultPort } from "@otterdeploy/shared/framework";
import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "./form-context";

interface Detection {
  framework: string | null;
  /** The framework's conventional listen port, when it has one. */
  defaultPort: number | null;
}

function useInspectQuery(repo: string, root: string): Detection {
  // Same query (and key) as the Builder step's DetectionBanner and the root
  // directory picker: react-query dedupes, so this adds no network cost.
  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const framework = inspect.data?.framework ?? null;
  return { framework, defaultPort: frameworkDefaultPort(framework) };
}

/** Step-view accessor (needs a mounted form context), for detection hints. */
export function useRepoDetection(): Detection {
  const form = useFormContext();
  const repo = useStore(form.store, (s) => s.values.repo);
  const root = useStore(form.store, (s) => s.values.root);
  return useInspectQuery(repo, root);
}
