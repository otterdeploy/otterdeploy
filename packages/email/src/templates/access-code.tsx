/** @jsxImportSource react */
import { CodePanel, EmailLayout, Footnote, Heading, Muted, Para } from "./_layout";

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
    <EmailLayout preview={`Your access code for ${domain}: ${code}`} footnote={null}>
      <Heading>Your access code</Heading>
      <Para tight>
        Enter this code to reach <strong>{domain}</strong>:
      </Para>
      <CodePanel code={code} />
      <Muted>
        This code expires in {expiresInMinutes} minutes and can be used once. Don&apos;t share it —
        anyone with the code can view the deployment.
      </Muted>
      <Footnote>If you didn&apos;t request this, you can safely ignore this email.</Footnote>
    </EmailLayout>
  );
}

export default AccessCodeEmail;
