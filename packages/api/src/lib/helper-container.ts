/**
 * The shared contract for short-lived HELPER containers: the one-shot
 * containers the control plane spawns over the docker socket to do work it
 * cannot do in-process (nsenter onto the host, read a volume, dump a volume).
 *
 * Two rules, both learned from a host that filled its disk:
 *
 *  1. Every helper sets `HostConfig.AutoRemove` so the DAEMON reaps it when it
 *     exits, independent of whatever the client library does on its way out.
 *     A client-side "remove when finished" only runs when the run finishes;
 *     it cannot help a container that was created and then never started.
 *  2. Every helper carries {@link HELPER_LABEL}, so anything that *does* leak
 *     is identifiable afterwards and can be swept (see `pruneHelperContainers`
 *     in routers/docker/service-admin.ts). An unlabeled helper is
 *     indistinguishable from a user's own container and can never be cleaned
 *     up safely.
 *
 * The leak this prevents: a helper is created, its start fails (disk full is
 * the classic trigger), and it sits in `Created` forever. AutoRemove never
 * fires for a container that never ran, so the droppings accumulate on the
 * very host that was already out of space.
 */

/** Label key marking a container as control-plane machinery, not a workload. */
export const HELPER_LABEL = "otterdeploy.role";

/** Which helper spawned it. Values are stable: the sweeper matches on the key,
 *  and operators read these in `docker ps`. */
export const HELPER_ROLES = {
  /** nsenter onto the host's namespaces (zpool/zfs). */
  host: "host-helper",
  /** Read-only browse of a volume's contents. */
  volumeExplore: "volume-explore-helper",
  /** Volume dump/restore for backups. */
  volumeBackup: "volume-backup-helper",
} as const;

export type HelperRole = (typeof HELPER_ROLES)[keyof typeof HELPER_ROLES];

/** The `Labels` map every helper container is created with. */
export function helperLabels(role: HelperRole): Record<string, string> {
  return { [HELPER_LABEL]: role };
}
