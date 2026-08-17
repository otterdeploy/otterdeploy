/** @jsxImportSource react */
import { BrandButton, EmailLayout, Footnote, Heading, Para } from "./_layout";

interface WelcomeEmailProps {
  username?: string;
  loginUrl: string;
}

export function WelcomeEmail({ username = "there", loginUrl }: WelcomeEmailProps) {
  return (
    <EmailLayout preview="Welcome to otterdeploy. Deploy your first service.">
      <Heading>Welcome to otterdeploy</Heading>
      <Para tight>Hi {username},</Para>
      <Para>
        Your account is ready. otterdeploy takes a git repository and runs it in production: builds,
        TLS, logs, and rollbacks handled, without the console sprawl.
      </Para>
      <Para>
        Point it at a repo whenever you&apos;re ready. The first deploy usually takes under a
        minute.
      </Para>
      <BrandButton href={loginUrl}>Deploy your first service</BrandButton>
      <Footnote>
        If you didn&apos;t create this account, you can safely ignore this email. Nothing was set
        up.
      </Footnote>
    </EmailLayout>
  );
}

export default WelcomeEmail;
