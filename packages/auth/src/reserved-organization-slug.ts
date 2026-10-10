/**
 * Refuse an organization slug the dashboard already answers at `/<slug>`.
 *
 * Organizations are created and renamed through better-auth's organization
 * endpoints, which the oRPC contracts never see, so the check runs in the
 * plugin's `beforeCreateOrganization` / `beforeUpdateOrganization` hooks. The
 * list itself lives in `@otterdeploy/shared/reserved-slugs` so the web route
 * tree and every create path read the same words.
 */
import { reservedSlugConflict } from "@otterdeploy/shared/reserved-slugs";
import { APIError } from "better-auth/api";

/** The message for a reserved slug, or null when the slug is free (or the
 *  update does not set one). */
export function reservedOrganizationSlugError(data: { slug?: unknown }): string | null {
  if (typeof data.slug !== "string") return null;
  return reservedSlugConflict("organization", data.slug);
}

/** Throws a 400 the dashboard shows inline when `data.slug` is reserved. */
export function assertOrganizationSlugAllowed(data: { slug?: unknown }): void {
  const message = reservedOrganizationSlugError(data);
  if (message) throw new APIError("BAD_REQUEST", { message, code: "RESERVED_SLUG" });
}
