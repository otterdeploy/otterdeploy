/**
 * Load a `PreviewScope` (the naming/scoping subset) from a preview id. The DB
 * companion to the pure rules in `./scoping`. Used by the deploy path + the
 * builder to decide whether a deployment is a preview (scoped names + image
 * override) or a normal base deploy.
 */
import type { PreviewId } from "@otterdeploy/shared/id";

import { getPreviewById } from "../../routers/project/queries";
import { type PreviewScope } from "./scoping";

export async function loadPreviewScope(
  previewId: PreviewId | null | undefined,
): Promise<PreviewScope | null> {
  if (!previewId) return null;
  const row = await getPreviewById(previewId);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    prNumber: row.prNumber,
  };
}
