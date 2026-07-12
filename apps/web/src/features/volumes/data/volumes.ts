/**
 * Volumes data access — one polled list query plus one-shot actions that
 * refetch it. The inventory is daemon-level and cheap to re-read, so actions
 * invalidate rather than patch a cache.
 */
import { orpc, queryClient } from "@/shared/server/orpc";

export const volumesListKey = orpc.volumes.list.queryKey({ input: {} });

export const volumesListQuery = () => ({
  ...orpc.volumes.list.queryOptions({ input: {} }),
  refetchInterval: 15_000,
  staleTime: 10_000,
});

function invalidate() {
  void queryClient.invalidateQueries({ queryKey: volumesListKey });
}

export async function createVolume(input: Parameters<typeof orpc.volumes.create.call>[0]) {
  const created = await orpc.volumes.create.call(input);
  invalidate();
  return created;
}

export async function removeVolume(name: string) {
  const result = await orpc.volumes.remove.call({ name });
  invalidate();
  return result;
}

export function inspectVolume(name: string) {
  return orpc.volumes.inspect.call({ name });
}
