import { RocketIcon } from "@hugeicons/core-free-icons";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { AuthLayout } from "@/features/auth/components/auth-layout";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

const zSearch = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/sign-in")({
  validateSearch: zSearch,
  component: SignInPage,
});

function SignInPage() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

  return (
    <AuthLayout
      eyebrow={mode === "sign-in" ? "Welcome back" : "Get started"}
      headline={
        mode === "sign-in" ? (
          <>
            Ship your stack.
            <br />
            <span className="font-normal text-muted-foreground">
              Sign in to deploy.
            </span>
          </>
        ) : (
          <>
            One account.
            <br />
            <span className="font-normal text-muted-foreground">
              Every deploy.
            </span>
          </>
        )
      }
      pill={{
        icon: RocketIcon,
        label: "Deploy from git in",
        value: "~ 90 seconds",
      }}
    >
      {mode === "sign-in" ? (
        <SignInForm onSwitchToSignUp={() => setMode("sign-up")} />
      ) : (
        <SignUpForm onSwitchToSignIn={() => setMode("sign-in")} />
      )}
    </AuthLayout>
  );
}
