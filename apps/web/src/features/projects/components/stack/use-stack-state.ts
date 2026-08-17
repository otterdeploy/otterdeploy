/**
 * State + server-mutation glue for the stack-code editor.
 *
 * Loads the rendered+saved+diff strings from `project.stack.diff`,
 * tracks edit-buffer + dirty state, and exposes typed save/apply
 * mutations. Save bumps stackFileVersion via optimistic lock and the
 * local version state advances on success.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
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

  // Seed / re-seed the buffer from the latest baseline (saved file or,
  // failing that, the rendered file). Adjust in render (not an effect) so
  // seeding doesn't cost an extra render pass; React bails out of the set
  // when the buffer already holds the seed value.
  //
  // Re-seed on baseline CHANGE, not just first load: applying a manifest
  // (wizard create, pending-bar Deploy) re-renders the stack yaml, and the
  // old seed-once guard kept the drawer pinned to the day-0 `services: {}`
  // until a hard reload. The user's in-progress edits still win. We only
  // follow the baseline while the buffer is untouched (not editing, and the
  // buffer still equals the previously seeded baseline).
  const [seededBaseline, setSeededBaseline] = useState<string | null>(null);
  if (diffQuery.data) {
    const baseline = diffQuery.data.savedYaml ?? diffQuery.data.renderedYaml;
    if (baseline !== seededBaseline) {
      const untouched = seededBaseline === null || (!editing && buffer === seededBaseline);
      if (untouched) setBuffer(baseline);
      setSeededBaseline(baseline);
    }
  }

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
        // Stack apply creates/updates real resources. Refresh the manifest
        // diff/get and the prefix-keyed graph collections too, so new nodes
        // appear without a reload.
        void invalidateManifestConsumers(projectId);
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
