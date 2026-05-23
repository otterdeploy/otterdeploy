import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

const zSearch = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: zSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign in failed");
      return;
    }
    void navigate({ to: (redirect ?? "/") as "/", replace: true });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("auth.signIn.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth.signIn.subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("auth.signIn.emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.signIn.emailPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("auth.signIn.passwordLabel")}</Label>
            <Link
              to="."
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("auth.signIn.forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.signIn.passwordPlaceholder")}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("common.loading") : t("auth.signIn.submit")}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t("auth.signIn.noAccount")}{" "}
        <Link
          to="/sign-up"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.signIn.createAccount")}
        </Link>
      </p>
    </form>
  );
}
