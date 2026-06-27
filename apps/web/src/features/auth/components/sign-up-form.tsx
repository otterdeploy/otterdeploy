import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import { SocialSignIn } from "./social-sign-in";

export function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/sign-in" });
  const { t } = useTranslation();

  const signUp = useMutation({
    mutationFn: async (input: { name: string; email: string; password: string }) => {
      const result = await authClient.signUp.email(input);
      if (result.error)
        throw new Error(result.error.message ?? result.error.statusText ?? "Sign up failed");
      return result.data;
    },
    onSuccess: () => {
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
              <Label
                htmlFor={field.name}
                className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
              >
                {t("auth.signUp.nameLabel")}
              </Label>
              <Input
                id={field.name}
                name={field.name}
                autoComplete="name"
                placeholder={t("auth.signUp.namePlaceholder")}
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

        <form.Field name="email">
          {(field) => (
            <div className="space-y-2">
              <Label
                htmlFor={field.name}
                className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
              >
                {t("auth.signUp.emailLabel")}
              </Label>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                placeholder={t("auth.signUp.emailPlaceholder")}
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
                className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
              >
                {t("auth.signUp.passwordLabel")}
              </Label>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                placeholder={t("auth.signUp.passwordPlaceholder")}
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
                  {t("auth.signUp.creatingAccount")}
                </>
              ) : (
                <>{t("auth.signUp.submit")}</>
              )}
            </Button>
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
