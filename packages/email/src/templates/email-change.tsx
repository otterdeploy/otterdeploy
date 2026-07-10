/** @jsxImportSource react */
import {
  BrandButton,
  DataTable,
  EmailLayout,
  Footnote,
  Heading,
  LinkFallback,
  Muted,
  Para,
} from "./_layout";

interface EmailChangeEmailProps {
  username?: string;
  newEmail?: string;
  confirmUrl?: string;
  expiresInMinutes?: number;
}

/**
 * Sent by the better-auth `sendChangeEmailVerification` flow to the *current*
 * address, so an email change has to be approved from the mailbox on file.
 */
export function EmailChangeEmail({
  username = "there",
  newEmail = "new@example.com",
  confirmUrl = "http://localhost:5173/confirm-email",
  expiresInMinutes = 60,
}: EmailChangeEmailProps) {
  return (
    <EmailLayout preview="Confirm the change to your otterdeploy email address." footnote={null}>
      <Heading>Confirm your new email</Heading>
      <Para tight>Hi {username},</Para>
      <Para>A request was made to change the email address on your otterdeploy account.</Para>
      <DataTable rows={[["new address", newEmail]]} />
      <BrandButton href={confirmUrl}>Confirm change</BrandButton>
      <LinkFallback href={confirmUrl} />
      <Muted>This link expires in {expiresInMinutes} minutes.</Muted>
      <Footnote>
        If you didn&apos;t request this, ignore this email — your address stays the same. You may
        want to review your account security.
      </Footnote>
    </EmailLayout>
  );
}

export default EmailChangeEmail;
