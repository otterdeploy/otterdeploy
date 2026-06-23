import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { env } from "@otterdeploy/env/web";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import { SocialSignIn } from "./social-sign-in";

/** The only legitimate absolute post-login redirect is the deployment-
 *  protection authorize endpoint, which lives on the server origin. Anything
 *  else is an open-redirect attempt — return null so the caller drops it. */
function safeServerRedirect(target: string): string | null {
  try {
    const url = new URL(target);
    if (url.origin === new URL(env.VITE_SERVER_URL).origin)
      return url.toString();
  } catch {
    // not a parseable absolute URL
  }
  return null;
}

export function SignInForm({
  onSwitchToSignUp,
}: {
  onSwitchToSignUp: () => void;
}) {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/sign-in" });
  const { t } = useTranslation();

  // Set once email+password succeed for a 2FA-enabled account — swaps the form
  // for the TOTP/backup-code challenge before a session is granted.
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  /** Finish login (after password, or after the 2FA challenge): honor a safe
   *  absolute deployment-protection redirect, else land on the internal path. */
  const completeLogin = () => {
    toast.success(t("auth.signIn.welcomeBack"));
    if (redirect && /^https?:\/\//i.test(redirect)) {
      const safe = safeServerRedirect(redirect);
      void (safe
        ? (window.location.href = safe)
        : navigate({ to: "/", replace: true }));
      return;
    }
    void navigate({ to: (redirect ?? "/") as "/", replace: true });
  };

  const signIn = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await authClient.signIn.email(input);
      if (result.error)
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Sign in failed",
        );
      return result.data;
    },
    onSuccess: (data) => {
      // 2FA-enabled accounts get no session yet — the server signals a pending
      // challenge instead. Show the code step rather than navigating.
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
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
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {t("auth.signIn.subtitle")}
        </p>
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
            <div className="space-y-2">
              <Label
                htmlFor={field.name}
                className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground"
              >
                {t("auth.signIn.emailLabel")}
              </Label>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                placeholder={t("auth.signIn.emailPlaceholder")}
                className="h-11 rounded-lg bg-muted px-3.5"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-sm text-destructive">
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <div className="space-y-2">
              <Label
                htmlFor={field.name}
                className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground"
              >
                {t("auth.signIn.passwordLabel")}
              </Label>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="current-password"
                placeholder={t("auth.signIn.passwordPlaceholder")}
                className="h-11 rounded-lg bg-muted px-3.5"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-sm text-destructive">
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state}>
          {(state) => (
            <Button
              type="submit"
              className="h-11 w-full rounded-lg bg-foreground font-semibold text-background hover:bg-foreground/90"
              disabled={!state.canSubmit || state.isSubmitting}
            >
              {state.isSubmitting ? (
                <>
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    strokeWidth={2}
                    className="size-4 animate-spin"
                  />
                  {t("auth.signIn.signingIn")}
                </>
              ) : (
                <>{t("auth.signIn.submit")}</>
              )}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <SocialSignIn dividerLabel="or continue with" />

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
    </div>
  );
}

/**
 * Second factor prompt shown after a correct password on a 2FA-enabled account.
 * Verifies a 6-digit authenticator code (or a one-time backup code) — only then
 * is the session granted. `trustDevice` skips the prompt on this device for 30d.
 */
function TwoFactorChallenge({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  const verify = useMutation({
    mutationFn: async () => {
      const value = code.trim();
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value, trustDevice });
      if (result.error)
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Invalid code",
        );
      return result.data;
    },
    onSuccess: onVerified,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
          Two-factor authentication
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {useBackup
            ? "Enter one of your saved backup codes."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) verify.mutate();
        }}
        className="space-y-5"
      >
        <div className="space-y-2">
          <Label
            htmlFor="two-factor-code"
            className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground"
          >
            {useBackup ? "Backup code" : "Authenticator code"}
          </Label>
          <Input
            id="two-factor-code"
            name="two-factor-code"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            placeholder={useBackup ? "xxxxxxxxxx" : "123456"}
            className="h-11 rounded-lg bg-muted px-3.5 font-mono tracking-[0.2em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        {!useBackup && (
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="size-3.5"
            />
            Trust this device for 30 days
          </label>
        )}

        <Button
          type="submit"
          className="h-11 w-full rounded-lg bg-foreground font-semibold text-background hover:bg-foreground/90"
          disabled={!code.trim() || verify.isPending}
        >
          {verify.isPending ? (
            <>
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className="size-4 animate-spin"
              />
              Verifying…
            </>
          ) : (
            <>Verify</>
          )}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setUseBackup((v) => !v);
          setCode("");
        }}
        className="mt-6 text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
      >
        {useBackup
          ? "Use your authenticator app instead"
          : "Use a backup code instead"}
      </button>
    </div>
  );
}
