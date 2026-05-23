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

export const Route = createFileRoute("/_auth/sign-up")({
  validateSearch: zSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign up failed");
      return;
    }
    void navigate({ to: (redirect ?? "/") as "/", replace: true });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("auth.signUp.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("auth.signUp.subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("auth.signUp.nameLabel")}</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("auth.signUp.namePlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">{t("auth.signUp.emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.signUp.emailPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.signUp.passwordLabel")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.signUp.passwordPlaceholder")}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("common.loading") : t("auth.signUp.submit")}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t("auth.signUp.hasAccount")}{" "}
        <Link
          to="/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.signUp.signIn")}
        </Link>
      </p>
    </form>
  );
}
