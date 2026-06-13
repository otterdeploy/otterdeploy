/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

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
    <Html>
      <Head />
      <Preview>{`${inviterName} invited you to join ${organizationName} on otterdeploy`}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto mb-16 max-w-[600px] rounded-md bg-white px-0 pb-12 pt-5">
            <Heading className="my-10 text-center text-2xl font-bold text-gray-800">
              Join {organizationName}
            </Heading>
            <Text className="px-12 text-base leading-7 text-gray-800">
              {inviterName} invited you to collaborate on{" "}
              <strong>{organizationName}</strong> as a <strong>{role}</strong> in
              otterdeploy.
            </Text>
            <Section className="py-7 text-center">
              <Button
                className="inline-block rounded-md bg-black px-8 py-3 text-base font-bold text-white no-underline"
                href={inviteUrl}
              >
                Accept invitation
              </Button>
            </Section>
            <Text className="px-12 text-sm leading-6 text-gray-500">
              Or paste this link into your browser:
              <br />
              <span className="break-all text-gray-700">{inviteUrl}</span>
            </Text>
            <Text className="mt-5 px-12 text-xs leading-6 text-gray-400">
              If you weren&apos;t expecting this invitation, you can safely ignore
              this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default OrganizationInvitationEmail;
