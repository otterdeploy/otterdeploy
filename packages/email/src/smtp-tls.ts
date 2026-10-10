/**
 * How an SMTP connection is secured, chosen explicitly and independently of
 * authentication.
 *
 *   implicit  TLS from the first byte (usually port 465).
 *   starttls  plain connect, then STARTTLS, required: a server that does not
 *             offer it fails the send rather than carrying mail in the clear.
 *   none      no TLS at all, credentials included. Only for a relay on a
 *             trusted network (a LAN smarthost, a local Postfix); it is the
 *             explicit opt-in the SDK otherwise refuses for authenticated
 *             relays.
 *
 * With no mode stored, the older single `secure` flag keeps meaning what it
 * did: true is implicit TLS; false upgrades with STARTTLS when there is a
 * username to protect and sends in plain text when there is not. That legacy
 * pairing is what made "authenticated relay without TLS" and "unauthenticated
 * relay that must use TLS" both impossible to express.
 */
export const SMTP_TLS_MODES = ["none", "starttls", "implicit"] as const;
export type SmtpTlsMode = (typeof SMTP_TLS_MODES)[number];

/** The SDK's TLS knobs (@opencoredev/email-sdk/smtp). */
export interface SmtpTlsOptions {
  secure: boolean;
  requireTLS: boolean;
  allowInsecureAuth: boolean;
}

/** A stored mode, or null for anything that is not one (unset, legacy, typo). */
export function parseSmtpTlsMode(value: unknown): SmtpTlsMode | null {
  return SMTP_TLS_MODES.find((mode) => mode === value) ?? null;
}

export function smtpTlsOptions(config: {
  tlsMode?: SmtpTlsMode | null;
  secure?: boolean;
}): SmtpTlsOptions {
  switch (config.tlsMode) {
    case "implicit":
      return { secure: true, requireTLS: false, allowInsecureAuth: false };
    case "starttls":
      return { secure: false, requireTLS: true, allowInsecureAuth: false };
    case "none":
      return { secure: false, requireTLS: false, allowInsecureAuth: true };
    default:
      // Legacy: the SDK's own default for this `secure` value.
      return { secure: config.secure === true, requireTLS: false, allowInsecureAuth: false };
  }
}
