import { createFileRoute, notFound } from "@tanstack/react-router";

/**
 * Instance zone — install administrators only.
 *
 * Every page under `/settings/instance/*` is backed by the platform-settings
 * router, which is install-admin in its entirety (16 of 16 procedures). The
 * sidebar already omits the link (`installAdminOnly` in the nav manifest), but
 * a typed or bookmarked URL bypasses navigation entirely — without this the
 * page would mount, fire its queries, and paint a settings shell full of 403s,
 * which reads as a broken app rather than a boundary.
 *
 * `notFound()` rather than a redirect or an "access denied" screen: for anyone
 * who is not an installation administrator this route does not exist. Same
 * idiom as the org and project layouts (`$orgSlug/layout.tsx`), so it lands on
 * the router's shared NotFound component.
 *
 * This is presentation only — the boundary is server-side, and every one of
 * those procedures re-checks the same flag in authz/capability.ts.
 *
 * No `component`: the route renders `<Outlet />` by default, so the guard adds
 * a gate and nothing else to the tree.
 */
export const Route = createFileRoute("/_app/$orgSlug/settings/instance")({
  beforeLoad: ({ context }) => {
    if (!context.isInstallAdmin) throw notFound();
  },
});
