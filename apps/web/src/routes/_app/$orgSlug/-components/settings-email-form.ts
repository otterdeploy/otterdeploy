import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { orpc } from "@/shared/server/orpc";

const { fieldContext, formContext } = createFormHookContexts();

// Empty field/form component sets — we only use the base `form.Field` /
// `form.Subscribe` API. createFormHook is here purely so `withForm` can split
// the email form across components while keeping every field strongly typed.
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {},
  formComponents: {},
});

export type EmailSettings = Awaited<
  ReturnType<typeof orpc.organization.getEmailSettings.call>
>;

export interface EmailFormValues {
  provider: "" | "resend" | "smtp";
  from: string;
  resendApiKey: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  testTo: string;
}

// Shape used only for `withForm` type inference — runtime values are irrelevant
// (the real defaults come from the live settings in EmailForm).
export const EMAIL_FORM_SHAPE: EmailFormValues = {
  provider: "",
  from: "",
  resendApiKey: "",
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  testTo: "",
};

/** Whether a send would succeed: an explicit provider with its credentials, or
 *  the env (RESEND_API_KEY) fallback. Mirrors transport.resolveTransport(). */
export function emailConfigured(s: EmailSettings): boolean {
  if (s.provider === "smtp") return Boolean(s.smtpHost);
  if (s.provider === "resend") return s.resendConfigured || s.envConfigured;
  return s.envConfigured;
}
