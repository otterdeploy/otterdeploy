/** @jsxImportSource react */
import {
  Badge,
  BrandButton,
  DataTable,
  EmailLayout,
  Footnote,
  Heading,
  Para,
} from "./_layout";

interface PasswordChangedEmailProps {
  username?: string;
  /** When it happened, already formatted for display. */
  changedAt?: string;
  ipAddress?: string;
  location?: string;
  /** Where to go if this wasn't them (reset / secure account). */
  secureUrl?: string;
}

/**
 * Security notice sent after a password is changed or reset completes. Not an
 * action email — it's a heads-up with a recovery path if it wasn't the user.
 */
export function PasswordChangedEmail({
  username = "there",
  changedAt = "just now",
  ipAddress,
  location,
  secureUrl = "http://localhost:5173/reset-password",
}: PasswordChangedEmailProps) {
  const rows: [string, string][] = [["when", changedAt]];
  if (location) rows.push(["location", location]);
  if (ipAddress) rows.push(["ip address", ipAddress]);

  return (
    <EmailLayout preview="Your otterdeploy password was changed." footnote={null}>
      <div style={{ marginBottom: "14px" }}>
        <Badge fg="#1f7a3f" bg="#eef8f1" border="#c3e6cf">
          Security
        </Badge>
      </div>
      <Heading>Your password was changed</Heading>
      <Para tight>Hi {username},</Para>
      <Para>The password on your otterdeploy account was just updated.</Para>
      <DataTable rows={rows} />
      <Footnote>
        Wasn&apos;t you? Secure your account right away — reset your password and review active
        sessions.
      </Footnote>
      <BrandButton href={secureUrl}>Secure my account</BrandButton>
    </EmailLayout>
  );
}

export default PasswordChangedEmail;
