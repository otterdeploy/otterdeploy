import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";

import { AuthInput, AuthSubmitButton } from "./auth-fields";
import { SocialSignIn } from "./social-sign-in";

export function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = useSearch({ from: "/sign-in" });
  const { t } = useTranslation();

  const signUp = useMutation({
    mutationFn: async (input: { name: string; email: string; password: string }) => {
      const result = await authClient.signUp.email(input);
      if (result.error)
        throw new Error(result.error.message ?? result.error.statusText ?? "Sign up failed");
      return result.data;
    },
    onSuccess: async () => {
      // A new session exists now — anything cached under ["auth", …] describes
      // the pre-sign-up (or previous) session.
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      void navigate({ to: (redirect ?? "/") as "/", replace: true });
      toast.success(t("auth.signUp.accountCreated"));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      await signUp.mutateAsync({
        name: value.name,
        email: value.email,
        password: value.password,
      });
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, t("auth.signUp.nameMinLength")),
        email: z.email(t("auth.signIn.invalidEmail")),
        password: z.string().min(8, t("auth.signIn.passwordMinLength")),
      }),
    },
  });

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
          {t("auth.signUp.title")}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{t("auth.signUp.subtitle")}</p>
      </div>

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
            <div className="space-y-2">
              <AuthInput
                id={field.name}
                name={field.name}
                label={t("auth.signUp.nameLabel")}
                autoComplete="name"
                placeholder={t("auth.signUp.namePlaceholder")}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-sm text-destructive">
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <div className="space-y-2">
              <AuthInput
                id={field.name}
                name={field.name}
                label={t("auth.signUp.emailLabel")}
                type="email"
                autoComplete="email"
                placeholder={t("auth.signUp.emailPlaceholder")}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
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
              <AuthInput
                id={field.name}
                name={field.name}
                label={t("auth.signUp.passwordLabel")}
                type="password"
                autoComplete="new-password"
                placeholder={t("auth.signUp.passwordPlaceholder")}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
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
            <AuthSubmitButton
              disabled={!state.canSubmit || state.isSubmitting}
              pending={state.isSubmitting}
              idleLabel={t("auth.signUp.submit")}
              pendingLabel={t("auth.signUp.creatingAccount")}
            />
          )}
        </form.Subscribe>
      </form>

      <SocialSignIn dividerLabel="or sign up with" />

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
