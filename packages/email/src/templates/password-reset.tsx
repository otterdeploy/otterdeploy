/** @jsxImportSource react */
import { BrandButton, EmailLayout, Footnote, Heading, LinkFallback, Muted, Para } from "./_layout";

interface PasswordResetEmailProps {
  username?: string;
  resetUrl?: string;
  expiresInMinutes?: number;
}

/**
 * Sent by the better-auth `sendResetPassword` flow. Single-purpose: get the
 * user to a reset form, and reassure them if they didn't ask.
 */
export function PasswordResetEmail({
  username = "there",
  resetUrl = "http://localhost:5173/reset-password",
  expiresInMinutes = 60,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout preview="Reset your otterdeploy password." footnote={null}>
      <Heading>Reset your password</Heading>
      <Para tight>Hi {username},</Para>
      <Para>
        We received a request to reset the password for your otterdeploy account. Choose a new one
        here:
      </Para>
      <BrandButton href={resetUrl}>Reset password</BrandButton>
      <LinkFallback href={resetUrl} />
      <Muted>This link expires in {expiresInMinutes} minutes and can be used once.</Muted>
      <Footnote>
        If you didn&apos;t request a reset, you can safely ignore this email — your password
        won&apos;t change.
      </Footnote>
    </EmailLayout>
  );
}

export default PasswordResetEmail;
