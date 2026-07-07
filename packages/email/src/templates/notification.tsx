/** @jsxImportSource react */
import { Column, Hr, Row, Section, Text } from "@react-email/components";

import { EmailLayout } from "./_layout";

export type NotificationSeverity = "info" | "ok" | "warn" | "err";

interface NotificationEmailProps {
  title?: string;
  message?: string;
  severity?: NotificationSeverity;
  /** Optional display context, rendered as a key/value table. Values are
   *  already presentation strings — the emitter formats them, not this view. */
  data?: Record<string, string>;
}

// Per-severity badge. Colors mirror the STYLE map used for Slack/Discord so a
// notification reads the same across channels.
const SEVERITY: Record<NotificationSeverity, { label: string; color: string; bg: string }> = {
  err: { label: "Error", color: "#ef4444", bg: "#fdecec" },
  warn: { label: "Warning", color: "#b45309", bg: "#fdf4e3" },
  ok: { label: "OK", color: "#047857", bg: "#e7f6ef" },
  info: { label: "Info", color: "#0369a1", bg: "#e6f2fb" },
};

/**
 * Platform notifications (deploy/build/backup/health/cert/ssh/audit events)
 * delivered to an email channel. Severity-badged, with an optional context
 * table. Like every otterdeploy email, it's a React Email component — never a
 * raw HTML string.
 */
export function NotificationEmail({
  title = "Notification",
  message = "",
  severity = "info",
  data,
}: NotificationEmailProps) {
  const s = SEVERITY[severity];
  const entries = data ? Object.entries(data).filter(([, v]) => v !== "") : [];

  return (
    <EmailLayout preview={title}>
      <Section
        className="mb-4 inline-block rounded-full px-3 py-1"
        style={{ backgroundColor: s.bg }}
      >
        <Text
          className="m-0 text-xs font-semibold tracking-wide uppercase"
          style={{ color: s.color }}
        >
          {s.label}
        </Text>
      </Section>
      <Text className="text-ink m-0 mb-3 text-lg font-semibold tracking-tight">{title}</Text>
      {message ? (
        <Text className="text-ink m-0 text-base leading-6 whitespace-pre-line">{message}</Text>
      ) : null}
      {entries.length ? (
        <>
          <Hr className="border-hairline my-6" />
          {entries.map(([key, value]) => (
            <Row key={key} className="mb-2">
              <Column className="w-2/5 align-top">
                <Text className="m-0 font-mono text-xs tracking-wide text-muted uppercase">
                  {key}
                </Text>
              </Column>
              <Column className="align-top">
                <Text className="text-ink m-0 font-mono text-xs break-words">{value}</Text>
              </Column>
            </Row>
          ))}
        </>
      ) : null}
    </EmailLayout>
  );
}

export default NotificationEmail;
