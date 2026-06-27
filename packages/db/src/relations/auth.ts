/**
 * Auth-domain relations: users, sessions, accounts, organizations, members,
 * and invitations.
 *
 * See `./index` for the shared conventions (`from`/`to` placement and
 * `optional` nullability semantics).
 */
import type { RelationBuilder } from "./builder";

export function authRelations(r: RelationBuilder) {
  return {
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      memberships: r.many.member(),
      sentInvitations: r.many.invitation(),
      teamMemberships: r.many.teamMember(),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id, optional: false }),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id, optional: false }),
    },
    organization: {
      members: r.many.member(),
      invitations: r.many.invitation(),
      projects: r.many.project(),
      servers: r.many.server(),
      gitProviders: r.many.gitProvider(),
      containerRegistries: r.many.containerRegistry(),
      auditLogs: r.many.auditLog(),
      backupDestinations: r.many.backupDestination(),
      backupSchedules: r.many.backupSchedule(),
      backups: r.many.backup(),
    },
    member: {
      organization: r.one.organization({
        from: r.member.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      user: r.one.user({ from: r.member.userId, to: r.user.id, optional: false }),
    },
    invitation: {
      organization: r.one.organization({
        from: r.invitation.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      inviter: r.one.user({
        from: r.invitation.inviterId,
        to: r.user.id,
        optional: false,
      }),
    },
  };
}
