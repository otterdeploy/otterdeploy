/** @jsxImportSource react */
import { EmailLayout, Heading, Para } from "./_layout";

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

  const blocks = paragraphs.length ? paragraphs : [body];

  return (
    <EmailLayout preview={heading ?? blocks[0] ?? "otterdeploy"}>
      {heading ? <Heading>{heading}</Heading> : null}
      {blocks.map((p, i) => (
        <Para key={i} tight={heading ? i === 0 : false}>
          {p}
        </Para>
      ))}
    </EmailLayout>
  );
}

export default MessageEmail;
