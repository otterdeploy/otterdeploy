import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { authQueryKeys } from "@/lib/auth-query-keys";

import type { AuthPublicConfig } from "../data/registration-mode";

import { AuthField, AuthSubmitButton } from "./auth-fields";
import { SocialSignIn } from "./social-sign-in";

/**
 * The mutation and the field state behind the sign-up form.
 *
 * Split out of the component so `SignUpForm` stays under the size cap and reads
 * as what it is: markup that decides which methods to draw. The validators
 * depend on `bootstrap` (the installer token is required only for the first
 * account), so this takes it as an argument rather than reading it twice.
 */
function useSignUpForm(bootstrap: boolean) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = useSearch({ from: "/sign-in" });
  const { t } = useTranslation();

  const signUp = useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      password: string;
      bootstrapToken: string;
    }) => {
      const { bootstrapToken, ...credentials } = input;
      const result = await authClient.signUp.email(credentials, {
        headers: bootstrap ? { "x-otterdeploy-bootstrap-token": bootstrapToken } : undefined,
      });
      if (result.error)
        throw new Error(result.error.message ?? result.error.statusText ?? "Sign up failed");
      return result.data;
    },
    onSuccess: async () => {
      // A new session exists now. Anything cached under ["auth", …] describes
      // the pre-sign-up (or previous) session.
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });
      void navigate({ to: redirect ?? "/", replace: true });
      toast.success(t("auth.signUp.accountCreated"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", bootstrapToken: "" },
    onSubmit: async ({ value }) => {
      await signUp.mutateAsync({
        name: value.name,
        email: value.email,
        password: value.password,
        bootstrapToken: value.bootstrapToken,
      });
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, t("auth.signUp.nameMinLength")),
        email: z.email(t("auth.signIn.invalidEmail")),
        password: z.string().min(8, t("auth.signIn.passwordMinLength")),
        bootstrapToken: bootstrap
          ? z.string().min(32, "Enter the bootstrap token printed by the installer")
          : z.string(),
      }),
    },
  });

  return form;
}

export function SignUpForm({
  bootstrap,
  config,
  onSwitchToSignIn,
}: {
  bootstrap: boolean;
  /** Which methods this installation offers. Served at runtime from
   *  /api/auth/public-config; the server refuses a disabled method's requests
   *  independently, so this only decides what is DRAWN. */
  config: AuthPublicConfig;
  onSwitchToSignIn: () => void;
}) {
  const { t } = useTranslation();
  const form = useSignUpForm(bootstrap);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
          {t("auth.signUp.title")}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{t("auth.signUp.subtitle")}</p>
      </div>

      {/* No password form when the operator has switched password sign-in off.
          Bootstrap is the exception and the server forces `password` true for
          it, because the first account can only be minted with the installer's
          token through /sign-up/email. */}
      {config.signIn.password ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-5"
        >
          <form.Field name="name">
            {(field) => (
              <AuthField
                field={field}
                label={t("auth.signUp.nameLabel")}
                autoComplete="name"
                placeholder={t("auth.signUp.namePlaceholder")}
              />
            )}
          </form.Field>

          <form.Field name="email">
            {(field) => (
              <AuthField
                field={field}
                label={t("auth.signUp.emailLabel")}
                type="email"
                autoComplete="email"
                placeholder={t("auth.signUp.emailPlaceholder")}
              />
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <AuthField
                field={field}
                label={t("auth.signUp.passwordLabel")}
                type="password"
                autoComplete="new-password"
                placeholder={t("auth.signUp.passwordPlaceholder")}
              />
            )}
          </form.Field>

          {bootstrap && (
            <form.Field name="bootstrapToken">
              {(field) => (
                <AuthField
                  field={field}
                  label={t("auth.signUp.bootstrapToken")}
                  type="password"
                  autoComplete="off"
                  placeholder={t("auth.signUp.bootstrapTokenPlaceholder")}
                  hint={t("auth.signUp.bootstrapTokenHint")}
                />
              )}
            </form.Field>
          )}

          <form.Subscribe selector={(state) => state}>
            {(state) => (
              <AuthSubmitButton
                disabled={!state.canSubmit || state.isSubmitting}
                pending={state.isSubmitting}
                idleLabel={t("auth.signUp.submit")}
                pendingLabel={t("auth.signUp.creatingAccount")}
              />
            )}
          </form.Subscribe>
        </form>
      ) : null}

      {/* Never during bootstrap: the first account has to carry the installer's
          bootstrap token, which an OAuth callback cannot safely bring back
          across the provider. See packages/auth/src/registration-policy.ts. */}
      {bootstrap ? null : (
        <SocialSignIn
          dividerLabel={config.signIn.password ? t("auth.signUp.dividerSignUp") : null}
          providers={config.socialProviders}
        />
      )}

      <p className="mt-6 text-[13px] text-muted-foreground">
        {t("auth.signUp.hasAccount")}{" "}
        <button
          type="button"
          onClick={onSwitchToSignIn}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.signUp.signIn")}
        </button>
      </p>
    </div>
  );
}
