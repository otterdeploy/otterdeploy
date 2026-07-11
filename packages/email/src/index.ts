export { sendEmail, sendViaSmtpServer } from "./client";
export type { SendEmailOptions, SmtpServerConfig } from "./client";
export { resolveTransport, invalidateTransport, hasEnvTransport } from "./transport";
export type { ResolvedTransport } from "./transport";

// Account & access
export { WelcomeEmail } from "./templates/welcome";
export { OrganizationInvitationEmail } from "./templates/organization-invitation";
export { AccessCodeEmail } from "./templates/access-code";

// Auth flows (better-auth)
export { EmailVerificationEmail } from "./templates/email-verification";
export { PasswordResetEmail } from "./templates/password-reset";
export { PasswordChangedEmail } from "./templates/password-changed";
export { EmailChangeEmail } from "./templates/email-change";
export { DeleteAccountEmail } from "./templates/delete-account";
export { MagicLinkEmail } from "./templates/magic-link";

// System & notifications
export { TestEmail } from "./templates/test-email";
export { MessageEmail } from "./templates/message";
export { NotificationEmail } from "./templates/notification";
export type { NotificationSeverity } from "./templates/notification";

export {
  EmailLayout,
  Heading,
  Para,
  Muted,
  Footnote,
  BrandButton,
  LinkFallback,
  Badge,
  CodePanel,
  DataTable,
  Divider,
  SEVERITY,
  brand,
} from "./templates/_layout";
