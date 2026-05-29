/**
 * Drizzle RQB v2 relations.
 *
 * Drizzle 1.0 dropped per-table `relations()` calls in favour of a
 * single `defineRelations()` block passed to the drizzle client. We
 * need this set so Better Auth's drizzle adapter can use the
 * relational query builder (`db.query.session.findFirst({ with: { user
 * } })`) when `experimental.joins` is on.
 *
 * Only auth-domain tables get relations today — the rest of the
 * codebase uses plain selects via `db.select()`, which doesn't need
 * any of this. Add relations here when a domain wants the RQB.
 */

import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    members: r.many.member(),
    invitations: r.many.invitation(),
  },

  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
    }),
  },

  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },

  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
  },

  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
    }),
  },

  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
    }),
  },
}));
