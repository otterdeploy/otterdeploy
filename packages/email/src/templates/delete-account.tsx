/** @jsxImportSource react */
import { BrandButton, EmailLayout, Footnote, Heading, LinkFallback, Muted, Para } from "./_layout";

interface DeleteAccountEmailProps {
  username?: string;
  confirmUrl?: string;
  expiresInMinutes?: number;
}

/**
 * Sent by the better-auth `sendDeleteAccountVerification` flow. This action is
 * destructive and irreversible, so the copy is blunt about consequences.
 */
export function DeleteAccountEmail({
  username = "there",
  confirmUrl = "http://localhost:5173/confirm-delete",
  expiresInMinutes = 60,
}: DeleteAccountEmailProps) {
  return (
    <EmailLayout preview="Confirm deletion of your otterdeploy account." footnote={null}>
      <Heading>Delete your account</Heading>
      <Para tight>Hi {username},</Para>
      <Para>
        You asked to delete your otterdeploy account. Confirming will permanently remove your
        account, its projects, deployments, and logs. This <strong>cannot be undone</strong>.
      </Para>
      <BrandButton href={confirmUrl}>Confirm and delete account</BrandButton>
      <LinkFallback href={confirmUrl} />
      <Muted>This link expires in {expiresInMinutes} minutes.</Muted>
      <Footnote>
        If you didn&apos;t request this, do not click the link — ignore this email and your account
        stays exactly as it is.
      </Footnote>
    </EmailLayout>
  );
}

export default DeleteAccountEmail;
