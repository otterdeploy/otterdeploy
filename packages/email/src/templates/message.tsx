/** @jsxImportSource react */
import { Text } from "@react-email/components";

import { EmailLayout } from "./_layout";

interface MessageEmailProps {
  /** Optional heading shown above the body. Defaults to the subject line. */
  heading?: string;
  /** Plain-text body. Blank lines split it into paragraphs; no HTML. */
  body: string;
}

/**
 * The generic branded shell for transactional/queue emails that carry a plain
 * message (welcome sequence, daily report, ad-hoc sends via the email.send
 * job). Callers pass plain text — this renders it, so no sender ever ships raw
 * HTML. Blank lines become paragraph breaks.
 */
export function MessageEmail({ heading, body }: MessageEmailProps) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <EmailLayout preview={heading ?? paragraphs[0] ?? "otterdeploy"}>
      {heading ? (
        <Text className="text-ink m-0 mb-4 text-lg font-semibold tracking-tight">{heading}</Text>
      ) : null}
      {(paragraphs.length ? paragraphs : [body]).map((p, i) => (
        <Text key={i} className="text-ink m-0 mb-3 text-base leading-6 whitespace-pre-line">
          {p}
        </Text>
      ))}
    </EmailLayout>
  );
}

export default MessageEmail;
