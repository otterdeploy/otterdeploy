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
   *  already presentation strings: the emitter formats them, not this view. */
  data?: Record<string, string>;
  /** Optional deep link into the app (e.g. the deployment or build page). */
  actionUrl?: string;
  actionLabel?: string;
  /** Catalog id, shown in the footnote. It is what an operator quotes when
   *  asking why they got this, and what a support reply searches on. */
  eventId?: string;
}

/**
 * Platform notifications (deploy/build/backup/health/cert/ssh/audit events)
 * delivered to an email channel. A severity stripe runs down the card, with a
 * badge, an optional context table, and an optional deep link. Like every
 * otterdeploy email, it's a React Email component, never a raw HTML string.
 *
 * The stripe and the badge stay HERE and only here. Every chat channel dropped
 * them, because there the emoji carries severity and a stripe forced a layout
 * indent. Email has neither constraint: the card is already a card, and the
 * severity chip is the fastest thing to read in a threaded mail client.
 *
 * The action is the one thing the card was missing. An alert that names a page
 * and then does not link it makes the reader go and find it, which is most of
 * the reason these got ignored.
 */
export function NotificationEmail({
  title = "Notification",
  message = "",
  severity = "info",
  data,
  actionUrl,
  actionLabel = "View in otterdeploy",
  eventId,
}: NotificationEmailProps) {
  const s = SEVERITY[severity];
  const entries = data ? Object.entries(data).filter(([, v]) => v !== "") : [];

  return (
    <EmailLayout
      preview={message ? `${title}: ${message}` : title}
      footnote={eventId ? `${eventId} · you are subscribed to this event` : null}
    >
      {/* Severity accent stripe: the one place semantic color leads. */}
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
