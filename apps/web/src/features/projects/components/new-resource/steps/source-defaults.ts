import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { useFormContext } from "../form-context";

import { inspectInput } from "../inspect-input";
import { createSourceDefaults, type SourceDefaults } from "./source-defaults-apply";

export type { SourceDefaults } from "./source-defaults-apply";

type WizardForm = ReturnType<typeof useFormContext>;

const INSPECT_STALE_MS = 5 * 60 * 1000;

export function useSourceDefaults(form: WizardForm): SourceDefaults {
  const queryClient = useQueryClient();
  // A mutable box that survives re-renders. Written only from event handlers
  // (the type toggle, "Change repo"), never read during render.
  const [kindPinned] = useState(() => ({ current: false }));

  return createSourceDefaults(
    form,
    {
      // Same query key the RepoCheck / framework badge / root picker use, so
      // this reads their cache rather than adding a request.
      inspect: (gitRepoId, path, branch) =>
        queryClient.fetchQuery({
          ...orpc.git.inspectRepo.queryOptions({ input: inspectInput(gitRepoId, path, branch) }),
          staleTime: INSPECT_STALE_MS,
        }),
      // Same key + staleTime the Variables step's own `useQuery` uses (it still
      // needs the response for the committed-env warning and the "pre-filled N
      // keys" note), so this warms that cache instead of adding a request.
      inspectEnv: (gitRepoId, path, branch) =>
        queryClient.fetchQuery({
          ...orpc.git.inspectEnv.queryOptions({ input: inspectInput(gitRepoId, path, branch) }),
          staleTime: INSPECT_STALE_MS,
        }),
    },
    kindPinned,
  );
}
