/** @jsxImportSource react */
import { Badge, BrandButton, EmailLayout, Footnote, Heading, LinkFallback, Para } from "./_layout";

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
    <EmailLayout
      preview={`${inviterName} invited you to join ${organizationName} on otterdeploy`}
      footnote={null}
    >
      <div style={{ marginBottom: "16px" }}>
        <Badge fg="#1f5fa8" bg="#eef3fb" border="#c9dbf1">
          Invitation
        </Badge>
      </div>
      <Heading>Join {organizationName}</Heading>
      <Para tight>
        {inviterName} invited you to collaborate on <strong>{organizationName}</strong> as a{" "}
        <strong>{role}</strong>. Accept to get access to its projects, deployments, and logs.
      </Para>
      <BrandButton href={inviteUrl}>Accept invitation</BrandButton>
      <LinkFallback href={inviteUrl} />
      <Footnote>
        If you weren&apos;t expecting this invitation, you can safely ignore this email.
      </Footnote>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
