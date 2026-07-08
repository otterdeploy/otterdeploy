/**
 * Load a `PreviewScope` (the naming/scoping subset) from a preview id. The DB
 * companion to the pure rules in `./scoping`. Used by the deploy path + the
 * builder to decide whether a deployment is a preview (scoped names + image
 * override) or a normal base deploy.
 */
import type { PreviewId } from "@otterdeploy/shared/id";

import { getPreviewById } from "../../routers/project/queries";
import { type PreviewScope } from "./scoping";

/** True when a preview still exists and is open (state='active'). The builder
 *  checks this right before rolling so it never recreates containers for a
 *  preview torn down mid-build. */
export async function isPreviewActive(previewId: PreviewId): Promise<boolean> {
  const row = await getPreviewById(previewId);
  return row?.state === "active";
}

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
