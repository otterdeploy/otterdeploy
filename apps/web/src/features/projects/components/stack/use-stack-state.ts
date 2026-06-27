/**
 * State + server-mutation glue for the stack-code editor.
 *
 * Loads the rendered+saved+diff strings from `project.stack.diff`,
 * tracks edit-buffer + dirty state, and exposes typed save/apply
 * mutations. Save bumps stackFileVersion via optimistic lock and the
 * local version state advances on success.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export interface UseStackStateInput {
  projectId: ProjectId;
}

export function useStackState({ projectId }: UseStackStateInput) {
  const queryClient = useQueryClient();
  const diffQuery = useQuery({
    ...orpc.project.stack.diff.queryOptions({ input: { projectId } }),
    refetchOnWindowFocus: false,
  });

  // The version counter starts at 0 on a fresh project and bumps on every
  // successful save. We pessimistically default to 0 so the first save
  // succeeds against a never-saved project.
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState("");

  // Seed the buffer once we have either the saved file or, failing that,
  // the rendered file. Subsequent re-renders skip — the user's in-progress
  // edits aren't clobbered by a background refetch.
  useEffect(() => {
    if (buffer.length > 0) return;
    if (!diffQuery.data) return;
    setBuffer(diffQuery.data.savedYaml ?? diffQuery.data.renderedYaml);
  }, [diffQuery.data, buffer.length]);

  const saveMut = useMutation(
    orpc.project.stack.save.mutationOptions({
      onSuccess: ({ version: next }) => {
        setVersion(next);
      },
      onError: (err) => toast.error(err.message ?? "Save failed"),
    }),
  );

  const applyMut = useMutation(
    orpc.project.stack.apply.mutationOptions({
      onSuccess: (result) => {
        setEditing(false);
        toast.success(
          result.skipped.length > 0
            ? `Applied ${result.appliedCount} · skipped ${result.skipped.length}`
            : `Applied ${result.appliedCount} services`,
        );
        void queryClient.invalidateQueries({
          queryKey: orpc.project.stack.diff.queryKey({ input: { projectId } }),
        });
      },
      onError: (err) => toast.error(err.message ?? "Apply failed"),
    }),
  );

  const saveAndApply = async () => {
    const saved = await saveMut.mutateAsync({
      projectId,
      yaml: buffer,
      expectedVersion: version,
    });
    setVersion(saved.version);
    await applyMut.mutateAsync({ projectId });
  };

  const discard = () => {
    if (!diffQuery.data) return;
    setBuffer(diffQuery.data.savedYaml ?? diffQuery.data.renderedYaml);
    setEditing(false);
  };

  const dirty = (() => {
    if (!diffQuery.data) return false;
    const baseline = diffQuery.data.savedYaml ?? diffQuery.data.renderedYaml;
    return buffer !== baseline;
  })();

  return {
    isLoading: diffQuery.isLoading,
    isError: diffQuery.isError,
    diff: diffQuery.data?.diff ?? "",
    rendered: diffQuery.data?.renderedYaml ?? "",
    saved: diffQuery.data?.savedYaml ?? null,
    buffer,
    setBuffer,
    editing,
    setEditing,
    dirty,
    version,
    saveAndApply,
    discard,
    isSaving: saveMut.isPending || applyMut.isPending,
  };
}
