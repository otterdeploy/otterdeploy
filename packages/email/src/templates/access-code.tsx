/** @jsxImportSource react */
import { Section, Text } from "@react-email/components";

import { EmailLayout, Footnote } from "./_layout";

interface AccessCodeEmailProps {
  /** The deployment domain the guest is trying to reach. */
  domain?: string;
  /** The one-time code. */
  code?: string;
  /** Minutes until the code expires (copy only). */
  expiresInMinutes?: number;
}

/**
 * The email one-time PIN a guest receives to unlock a protected deployment
 * (deploy-protection guest flow). Code is shown large + monospaced.
 */
export function AccessCodeEmail({
  domain = "your deployment",
  code = "000000",
  expiresInMinutes = 10,
}: AccessCodeEmailProps) {
  return (
    <EmailLayout preview={`Your code for ${domain}: ${code}`}>
      <Text className="text-ink m-0 text-base leading-6">
        Your one-time code to access <strong>{domain}</strong>:
      </Text>
      <Section className="border-hairline bg-canvas my-6 rounded-lg border border-solid py-5 text-center">
        <Text className="text-ink m-0 font-mono text-[34px] font-bold tracking-[10px]">{code}</Text>
      </Section>
      <Text className="m-0 text-sm leading-6 text-muted">
        This code expires in {expiresInMinutes} minutes.
      </Text>
      <Footnote>If you didn&apos;t request this, you can safely ignore this email.</Footnote>
    </EmailLayout>
  );
}

export default AccessCodeEmail;
