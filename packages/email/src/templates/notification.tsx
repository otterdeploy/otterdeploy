/** @jsxImportSource react */
import { Section, Text } from "@react-email/components";

import {
  Badge,
  BrandButton,
  DataTable,
  EmailLayout,
  Heading,
  type NotificationSeverity,
  SEVERITY,
} from "./_layout";

export type { NotificationSeverity };

interface NotificationEmailProps {
  title?: string;
  message?: string;
  severity?: NotificationSeverity;
  /** Optional display context, rendered as a key/value table. Values are
   *  already presentation strings — the emitter formats them, not this view. */
  data?: Record<string, string>;
  /** Optional deep link into the app (e.g. the deployment or build page). */
  actionUrl?: string;
  actionLabel?: string;
}

/**
 * Platform notifications (deploy/build/backup/health/cert/ssh/audit events)
 * delivered to an email channel. A severity stripe runs down the card, with a
 * badge, an optional context table, and an optional deep link. Like every
 * otterdeploy email, it's a React Email component — never a raw HTML string.
 */
export function NotificationEmail({
  title = "Notification",
  message = "",
  severity = "info",
  data,
  actionUrl,
  actionLabel = "View in otterdeploy",
}: NotificationEmailProps) {
  const s = SEVERITY[severity];
  const entries = data ? Object.entries(data).filter(([, v]) => v !== "") : [];

  return (
    <EmailLayout preview={message ? `${title} — ${message}` : title} footnote={null}>
      {/* Severity accent stripe — the one place semantic color leads. */}
      <Section
        className="mb-6 rounded-full"
        style={{ height: "3px", width: "44px", backgroundColor: s.fg }}
      />
      <div style={{ marginBottom: "14px" }}>
        <Badge fg={s.fg} bg={s.bg} border={s.border}>
          {s.label}
        </Badge>
      </div>
      <Heading>{title}</Heading>
      {message ? (
        <Text className="text-body m-0 mt-4 text-[15px] leading-[25px] whitespace-pre-line">
          {message}
        </Text>
      ) : null}
      <DataTable rows={entries} />
      {actionUrl ? <BrandButton href={actionUrl}>{actionLabel}</BrandButton> : null}
    </EmailLayout>
  );
}

export default NotificationEmail;
