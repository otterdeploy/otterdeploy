import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { env } from "@otterdeploy/env/web";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

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

  const signIn = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await authClient.signIn.email(input);
      if (result.error)
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Sign in failed",
        );
      return result.data;
    },
    onSuccess: () => {
      toast.success(t("auth.signIn.welcomeBack"));
      // Deployment-protection sends an absolute `redirect` (the auth-wall
      // authorize URL on the server origin) — that needs a full navigation,
      // not TanStack's internal router. Internal paths use navigate().
      if (redirect && /^https?:\/\//i.test(redirect)) {
        const safe = safeServerRedirect(redirect);
        // Untrusted absolute URL ⇒ drop it (open-redirect guard) and land home.
        void (safe
          ? (window.location.href = safe)
          : navigate({ to: "/", replace: true }));
        return;
      }
      void navigate({ to: (redirect ?? "/") as "/", replace: true });
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
