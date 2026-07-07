/** @jsxImportSource react */
import { Text } from "@react-email/components";

import { BrandButton, EmailLayout, Footnote } from "./_layout";

interface WelcomeEmailProps {
  username?: string;
  loginUrl?: string;
}

export function WelcomeEmail({
  username = "there",
  loginUrl = "http://localhost:5173",
}: WelcomeEmailProps) {
  return (
    <EmailLayout preview="Welcome to otterdeploy!">
      <Text className="text-ink m-0 mb-4 text-lg font-semibold tracking-tight">
        Welcome to otterdeploy
      </Text>
      <Text className="text-ink m-0 text-base leading-6">Hi {username},</Text>
      <Text className="text-ink m-0 mt-3 text-base leading-6">
        Thanks for signing up — we&apos;re glad you&apos;re here. Deploy your first service whenever
        you&apos;re ready.
      </Text>
      <BrandButton href={loginUrl}>Get started</BrandButton>
      <Footnote>If you didn&apos;t create an account, you can safely ignore this email.</Footnote>
    </EmailLayout>
  );
}

export default WelcomeEmail;
