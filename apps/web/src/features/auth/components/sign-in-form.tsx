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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

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
      void navigate({ to: (redirect ?? "/") as "/", replace: true });
      toast.success(t("auth.signIn.welcomeBack"));
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
    <Card className="border-none bg-transparent shadow-none ring-0">
      <CardHeader className="pb-0 text-center">
        <CardTitle className="text-xl font-semibold tracking-tight">
          {t("auth.signIn.title")}
        </CardTitle>
        <CardDescription>{t("auth.signIn.subtitle")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>
                  {t("auth.signIn.emailLabel")}
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.signIn.emailPlaceholder")}
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
                <Label htmlFor={field.name}>
                  {t("auth.signIn.passwordLabel")}
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  placeholder={t("auth.signIn.passwordPlaceholder")}
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
                className="w-full"
                disabled={!state.canSubmit || state.isSubmitting}
              >
                {state.isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      strokeWidth={2}
                      className="size-4 animate-spin"
                    />
                    {t("auth.signIn.signingIn")}
                  </span>
                ) : (
                  t("auth.signIn.submit")
                )}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {t("auth.signIn.noAccount")}{" "}
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={onSwitchToSignUp}
          >
            {t("auth.signIn.createAccount")}
          </Button>
        </p>
      </CardFooter>
    </Card>
  );
}
