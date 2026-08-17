import { useState } from "react";

import { env } from "@otterdeploy/env/web";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { clearAuthCache } from "@/lib/auth-queries";

import { AuthField, AuthSubmitButton } from "./auth-fields";
import { EnterpriseSsoSignIn } from "./enterprise-sso-sign-in";
import { PasskeySignIn } from "./passkey-sign-in";
import { SocialSignIn } from "./social-sign-in";
import { TwoFactorChallenge } from "./two-factor-challenge";

/** The only legitimate absolute post-login redirect is the deployment-
 *  protection authorize endpoint, which lives on the server origin. Anything
 *  else is an open-redirect attempt. Return null so the caller drops it. */
function safeServerRedirect(target: string): string | null {
  try {
    const url = new URL(target);
    if (url.origin === new URL(env.VITE_SERVER_URL).origin) return url.toString();
  } catch {
    // not a parseable absolute URL
  }
  return null;
}

export function SignInForm({
  allowSignUp,
  socialProviders,
  onSwitchToSignUp,
}: {
  allowSignUp: boolean;
  /** Provider ids live on the server right now. See /api/auth/public-config. */
  socialProviders: string[];
  onSwitchToSignUp: () => void;
}) {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/sign-in" });
  const { t } = useTranslation();

  // Set once email+password succeed for a 2FA-enabled account. Swaps the form
  // for the TOTP/backup-code challenge before a session is granted.
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  /** Finish login (after password, or after the 2FA challenge): honor a safe
   *  absolute deployment-protection redirect, else land on the internal path. */
  const completeLogin = () => {
    // A session exists now, but the gate's cache may still hold the `null` that
    // sent us to /sign-in in the first place. Drop it before navigating or the
    // redirect bounces straight back here. See lib/auth-queries.ts.
    clearAuthCache();
    toast.success(t("auth.signIn.welcomeBack"));
    if (redirect && /^https?:\/\//i.test(redirect)) {
      const safe = safeServerRedirect(redirect);
      void (safe ? (window.location.href = safe) : navigate({ to: "/", replace: true }));
      return;
    }
    void navigate({ to: redirect ?? "/", replace: true });
  };

  const signIn = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await authClient.signIn.email(input);
      if (result.error)
        throw new Error(result.error.message ?? result.error.statusText ?? "Sign in failed");
      return result.data;
    },
    onSuccess: (data) => {
      // 2FA-enabled accounts get no session yet. The server signals a pending
      // challenge instead. Show the code step rather than navigating.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      completeLogin();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await signIn.mutateAsync({
        email: value.email,
        password: value.password,
      });
    },
    validators: {
      onSubmit: z.object({
        email: z.email(t("auth.signIn.invalidEmail")),
        password: z.string().min(8, t("auth.signIn.passwordMinLength")),
      }),
    },
  });

  // All hooks above run unconditionally; the 2FA challenge swaps the rendered
  // tree only after they've been called.
  if (twoFactorRequired) {
    return <TwoFactorChallenge onVerified={completeLogin} />;
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
          {t("auth.signIn.title")}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{t("auth.signIn.subtitle")}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-5"
      >
        <form.Field name="email">
          {(field) => (
            <AuthField
              field={field}
              label={t("auth.signIn.emailLabel")}
              type="email"
              autoComplete="email"
              placeholder={t("auth.signIn.emailPlaceholder")}
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <AuthField
              field={field}
              label={t("auth.signIn.passwordLabel")}
              type="password"
              autoComplete="current-password"
              placeholder={t("auth.signIn.passwordPlaceholder")}
            />
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state}>
          {(state) => (
            <AuthSubmitButton
              disabled={!state.canSubmit || state.isSubmitting}
              pending={state.isSubmitting}
              idleLabel={t("auth.signIn.submit")}
              pendingLabel={t("auth.signIn.signingIn")}
            />
          )}
        </form.Subscribe>
      </form>

      <SocialSignIn dividerLabel="or continue with" providers={socialProviders} />

      {/* Passkey sign-in completes with a full session (first factor + user
          verification), so it reuses completeLogin directly — no 2FA step. */}
      <PasskeySignIn onSignedIn={completeLogin} />

      {/* Always rendered, unlike SocialSignIn: whether SSO applies depends on
          the email domain the visitor types, which we cannot know up front. */}
      <EnterpriseSsoSignIn />

      {allowSignUp ? (
        <p className="mt-6 text-[13px] text-muted-foreground">
          {t("auth.signIn.noAccount")}{" "}
          <button
            type="button"
            onClick={onSwitchToSignUp}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("auth.signIn.createAccount")}
          </button>
        </p>
      ) : (
        <p className="mt-6 text-[13px] text-muted-foreground">
          Account creation is invitation-only on this installation.
        </p>
      )}
    </div>
  );
}
