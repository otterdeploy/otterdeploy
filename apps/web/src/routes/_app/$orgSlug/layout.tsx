import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import * as z from "zod";

import { UpdateProvider } from "@/features/updates";

const zOrgSlug = z.object({
  orgSlug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

/**
 * Org context only — no chrome. The two chromes live in the child layouts
 * and never coexist:
 *
 *   - `_shell/layout.tsx`    — the operational shell (header + org sidebar).
 *   - `settings/layout.tsx`  — the settings zone (own rail, no org sidebar).
 *
 * UpdateProvider lives HERE (not in `_shell`) because both chromes consume
 * it: the shell renders the banner, and the settings zone's Instance →
 * General page hosts the UpdatesCard (`useUpdate`).
 */
export const Route = createFileRoute("/_app/$orgSlug")({
  component: () => (
    <UpdateProvider>
      <Outlet />
    </UpdateProvider>
  ),
  params: {
    parse: zOrgSlug.parse,
  },
  loader: ({ context, params }) => {
    const organization = context.organizations.find(
      (o) => o.slug === params.orgSlug,
    );
    if (!organization) throw notFound();
    return { crumb: organization.name, organization };
  },
});
