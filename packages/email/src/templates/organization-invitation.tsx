/** @jsxImportSource react */
import { Text } from "@react-email/components";

import { BrandButton, EmailLayout, Footnote } from "./_layout";

interface OrganizationInvitationEmailProps {
  organizationName?: string;
  inviterName?: string;
  inviteUrl?: string;
  role?: string;
}

export function OrganizationInvitationEmail({
  organizationName = "the workspace",
  inviterName = "A teammate",
  inviteUrl = "http://localhost:5173",
  role = "member",
}: OrganizationInvitationEmailProps) {
  return (
    <EmailLayout preview={`${inviterName} invited you to join ${organizationName} on otterdeploy`}>
      <Text className="text-ink m-0 mb-4 text-lg font-semibold tracking-tight">
        Join {organizationName}
      </Text>
      <Text className="text-ink m-0 text-base leading-6">
        {inviterName} invited you to collaborate on <strong>{organizationName}</strong> as a{" "}
        <strong>{role}</strong> in otterdeploy.
      </Text>
      <BrandButton href={inviteUrl}>Accept invitation</BrandButton>
      <Text className="m-0 text-sm leading-6 text-muted">
        Or paste this link into your browser:
        <br />
        <span className="text-ink break-all">{inviteUrl}</span>
      </Text>
      <Footnote>
        If you weren&apos;t expecting this invitation, you can safely ignore this email.
      </Footnote>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
