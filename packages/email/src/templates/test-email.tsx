/** @jsxImportSource react */
import { Text } from "@react-email/components";

import { EmailLayout } from "./_layout";

/**
 * Sent from Settings → Email to confirm the configured transport actually
 * delivers. Deliberately minimal — its job is to arrive, not to sell anything.
 */
export function TestEmail() {
  return (
    <EmailLayout preview="Your otterdeploy email transport is working.">
      <Text className="text-ink m-0 text-base leading-6">
        This is a test email from otterdeploy.
      </Text>
      <Text className="m-0 mt-3 text-sm leading-6 text-muted">
        If you&apos;re reading this, your email transport is configured correctly.
      </Text>
    </EmailLayout>
  );
}

export default TestEmail;
