import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

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
    <div className="grid min-h-svh place-items-center bg-background p-6">
      <div className="relative z-10 mx-4 w-full max-w-[420px]">
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {mode === "sign-in" ? (
            <SignInForm onSwitchToSignUp={() => setMode("sign-up")} />
          ) : (
            <SignUpForm onSwitchToSignIn={() => setMode("sign-in")} />
          )}
        </div>
      </div>
    </div>
  );
}
