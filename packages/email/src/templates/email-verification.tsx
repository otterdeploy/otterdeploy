/** @jsxImportSource react */
import { BrandButton, EmailLayout, Footnote, Heading, LinkFallback, Muted, Para } from "./_layout";

interface EmailVerificationEmailProps {
  username?: string;
  verifyUrl?: string;
  expiresInMinutes?: number;
}

/**
 * Sent by the better-auth `sendVerificationEmail` flow to confirm a new
 * address before the account is fully activated.
 */
export function EmailVerificationEmail({
  username = "there",
  verifyUrl = "http://localhost:5173/verify",
  expiresInMinutes = 60,
}: EmailVerificationEmailProps) {
  return (
    <EmailLayout preview="Verify your email to finish setting up otterdeploy." footnote={null}>
      <Heading>Verify your email</Heading>
      <Para tight>Hi {username},</Para>
      <Para>
        Confirm this is your email address to activate your otterdeploy account and start deploying.
      </Para>
      <BrandButton href={verifyUrl}>Verify email address</BrandButton>
      <LinkFallback href={verifyUrl} />
      <Muted>This link expires in {expiresInMinutes} minutes.</Muted>
      <Footnote>
        If you didn&apos;t create an otterdeploy account, you can safely ignore this email.
      </Footnote>
    </EmailLayout>
  );
}

export default EmailVerificationEmail;
