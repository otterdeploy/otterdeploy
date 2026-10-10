import { FALLBACK_ENV_SLUG } from "@/features/shell/environment-default";

/**
 * The environment segment for links the canvas builds. The active environment
 * is resolved from the URL, or the project's default on the project index;
 * `production` covers the moment before the environment list has loaded, and
 * the resource route corrects a wrong one in place.
 */
export function canvasEnvSlug(slug: string | undefined): string {
  return slug ?? FALLBACK_ENV_SLUG;
}

// Applied resources carry the real resourceId on data; a pending-create ghost
// has none, so fall back to the node id (`${kind}:${name}`). The $resourceId
// route resolves either form.
function nodeTargetId(node: { id: string; data: { resourceId?: unknown } }): string {
  const real = node.data.resourceId;
  return typeof real === "string" ? real : node.id;
}

/** What a node opens: a preview satellite its preview panel, everything else
 *  its resource panel. Null for a preview with no id yet. */
export function canvasNodeTarget(node: {
  id: string;
  data: { kind?: unknown; preview?: { id?: unknown } | null; resourceId?: unknown };
}): { kind: "preview"; previewId: string } | { kind: "resource"; resourceId: string } | null {
  if (node.data.kind === "preview") {
    const id = node.data.preview?.id;
    return typeof id === "string" && id.length > 0 ? { kind: "preview", previewId: id } : null;
  }
  return { kind: "resource", resourceId: nodeTargetId(node) };
}
