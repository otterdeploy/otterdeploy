/**
 * Who a container on the daemon belongs to, from the labels the platform
 * stamps. The server's Containers tab groups by this: a project's resources,
 * the install's own platform containers, and everything else.
 *
 *   - resource: `otterdeploy.resource.id` (every deployed service, database
 *     and compose member), with the project as a slug (`otterdeploy.project`)
 *     or, for compose members, an id (`otterdeploy.project.id`).
 *   - platform: the install's own compose project / stack namespace, or a
 *     platform-managed container with no resource (the health agent, build
 *     and backup helpers), named by `otterdeploy.role` when stamped.
 *   - unmanaged: started by someone else on the same daemon.
 */

export type ContainerOwner =
  | { kind: "resource"; projectSlug: string | null; projectId: string | null; resourceId: string }
  | { kind: "platform"; role: string | null }
  | { kind: "unmanaged" };

const ownsInstall = (value: string | undefined): boolean => (value ?? "").startsWith("otterdeploy");

export function containerOwner(labels: Record<string, string> | undefined): ContainerOwner {
  if (!labels) return { kind: "unmanaged" };
  const resourceId = labels["otterdeploy.resource.id"];
  if (resourceId) {
    return {
      kind: "resource",
      projectSlug: labels["otterdeploy.project"] ?? null,
      projectId: labels["otterdeploy.project.id"] ?? null,
      resourceId,
    };
  }
  if (
    labels["otterdeploy.managed"] === "true" ||
    ownsInstall(labels["com.docker.compose.project"]) ||
    ownsInstall(labels["com.docker.stack.namespace"])
  ) {
    return { kind: "platform", role: labels["otterdeploy.role"] ?? null };
  }
  return { kind: "unmanaged" };
}
