import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export function SignInForm() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_auth/sign-in" }) as { redirect?: string };
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onChange: signInSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign-in failed");
        return;
      }
      void navigate({ to: search.redirect ?? "/" });
    },
  });

  return (
    <AuthShell
      title="Sign in to otterstack"
      description="Enter your email and password to continue."
      footer={
        <>
          New here?{" "}
          <Link
            to={"/sign-up" as "/sign-in"}
            className="font-medium text-foreground hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Password</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] ? (
                <FieldError>{String(field.state.meta.errors[0])}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
