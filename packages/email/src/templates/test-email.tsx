/** @jsxImportSource react */
import { Badge, DataTable, EmailLayout, Heading, Muted, Para } from "./_layout";

interface TestEmailProps {
  /** How the transport was configured, for the operator to sanity-check. */
  provider?: string;
  fromAddress?: string;
}

/**
 * Sent from Settings → Email to confirm the configured transport actually
 * delivers. Deliberately minimal — its job is to arrive and prove the wiring,
 * not to sell anything.
 */
export function TestEmail({ provider, fromAddress }: TestEmailProps = {}) {
  const rows: [string, string][] = [];
  if (provider) rows.push(["provider", provider]);
  if (fromAddress) rows.push(["from", fromAddress]);

  return (
    <EmailLayout preview="Your otterdeploy email transport is working." footnote={null}>
      <div style={{ marginBottom: "14px" }}>
        <Badge fg="#1f7a3f" bg="#eef8f1" border="#c3e6cf">
          Delivered
        </Badge>
      </div>
      <Heading>Email is configured</Heading>
      <Para tight>
        If you&apos;re reading this, otterdeploy can send mail through your configured transport.
        Invitations, notifications, and account emails will go out from here.
      </Para>
      <DataTable rows={rows} />
      <Muted>This is a one-off test. Nothing else was sent.</Muted>
    </EmailLayout>
  );
}

export default TestEmail;
