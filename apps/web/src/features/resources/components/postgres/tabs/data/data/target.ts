/**
 * WHICH database the workbench is pointed at.
 *
 * A managed resource and a saved external connection are addressed differently
 * — one by `resourceId`, one by `connectionId` — and the server resolves their
 * credentials from different places. Above that seam nothing else differs, so
 * every hook and component here takes this one value and is written once.
 *
 * A discriminated union rather than two optional ids: a target naming both is
 * a target with no answer, and making it unrepresentable is cheaper than
 * checking for it.
 */
export type WorkbenchTarget =
  | { kind: "resource"; resourceId: string }
  | { kind: "connection"; connectionId: string };

export function resourceTarget(resourceId: string): WorkbenchTarget {
  return { kind: "resource", resourceId };
}

export function connectionTarget(connectionId: string): WorkbenchTarget {
  return { kind: "connection", connectionId };
}

/**
 * A stable string for the target, for cache keys and collection ids.
 *
 * Prefixed by kind so a resource id and a connection id can never collide into
 * one cache entry — they are different databases even if the ids matched.
 */
export function targetKey(target: WorkbenchTarget): string {
  return target.kind === "resource"
    ? `resource:${target.resourceId}`
    : `connection:${target.connectionId}`;
}
