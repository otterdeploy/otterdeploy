/**
 * Slugs a user may not take because a URL already means something there.
 *
 * Every user slug in the dashboard sits in a path segment, and a static page
 * at the same level wins the match. An organization slugged `status` would be
 * shadowed by the public status pages; an environment slugged `settings` by
 * the project's settings page. The org or environment would exist and be
 * unreachable, which reads as a broken link rather than a naming rule. So the
 * words are refused when the slug is chosen, at create and at rename.
 *
 * The lists track the route tree (`apps/web/src/routes`):
 *   - organization: `/$orgSlug` sits beside the root pages (sign-in, device,
 *     accept-invite, onboarding, the terminal pop-out, public status pages)
 *     and the paths the server answers before the SPA (`/api`, `/rpc`, …).
 *   - project: `/$orgSlug/projects/$projectSlug` has no static sibling, so
 *     nothing is reserved. The list exists so a page added there later has an
 *     obvious place to say so, and a web test walks the route tree to keep it
 *     honest.
 *   - environment: `/…/projects/$projectSlug/$envSlug` sits beside the
 *     project's own pages.
 *
 * Parsing an EXISTING slug (a route param, a stored row) must not apply this:
 * a slug taken before a word was reserved has to stay readable.
 */

export type SlugKind = "organization" | "project" | "environment";

export const RESERVED_SLUGS = {
  organization: [
    "sign-in",
    "device",
    "accept-invite",
    "onboarding",
    "terminal",
    "status",
    "api",
    "rpc",
    "jobs",
    "pty",
    "health",
    "assets",
  ],
  project: [],
  environment: ["settings", "variables", "previews"],
} as const satisfies Record<SlugKind, readonly string[]>;

const KIND_LABEL: Record<SlugKind, string> = {
  organization: "organization",
  project: "project",
  environment: "environment",
};

/** Why `slug` cannot be used for `kind`, phrased for the person choosing it,
 *  or null when it is free to use. */
export function reservedSlugConflict(kind: SlugKind, slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  const reserved: readonly string[] = RESERVED_SLUGS[kind];
  if (!reserved.includes(normalized)) return null;
  return `"${normalized}" is reserved: the dashboard already has a page at that address. Pick another ${KIND_LABEL[kind]} slug.`;
}
