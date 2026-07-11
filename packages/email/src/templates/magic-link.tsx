/** @jsxImportSource react */
import { BrandButton, EmailLayout, Footnote, Heading, LinkFallback, Muted, Para } from "./_layout";

interface MagicLinkEmailProps {
  loginUrl?: string;
  expiresInMinutes?: number;
}

/**
 * Passwordless sign-in link (better-auth `magicLink` plugin). No password, so
 * the link itself is the credential — the copy stresses not sharing it.
 */
export function MagicLinkEmail({
  loginUrl = "http://localhost:5173/magic",
  expiresInMinutes = 10,
}: MagicLinkEmailProps) {
  return (
    <EmailLayout preview="Your sign-in link for otterdeploy." footnote={null}>
      <Heading>Sign in to otterdeploy</Heading>
      <Para tight>Click below to sign in. No password needed.</Para>
      <BrandButton href={loginUrl}>Sign in</BrandButton>
      <LinkFallback href={loginUrl} />
      <Muted>
        This link expires in {expiresInMinutes} minutes and works once. Don&apos;t forward it —
        anyone with the link can sign in as you.
      </Muted>
      <Footnote>If you didn&apos;t try to sign in, you can safely ignore this email.</Footnote>
    </EmailLayout>
  );
}

export default MagicLinkEmail;
