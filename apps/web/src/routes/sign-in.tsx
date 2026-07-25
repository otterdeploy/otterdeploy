import { RocketIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { AuthLayout } from "@/features/auth/components/auth-layout";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { fetchRegistrationMode } from "@/features/auth/data/registration-mode";

// `mode` is the URL's source of truth for the sign-in/sign-up toggle (was a
// local useState) — otherwise sharing a "create an account" link or hitting
// refresh mid-signup silently dumped the visitor back on Sign in with no way
// to deep-link straight to the form they wanted.
const zSearch = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: zSearch,
  component: SignInPage,
});

function SignInPage() {
  const { mode: modeParam, redirect } = Route.useSearch();
  const navigate = Route.useNavigate();
  const registration = useQuery({
    queryKey: ["auth", "registration-mode"],
    queryFn: fetchRegistrationMode,
    staleTime: 0,
    retry: false,
  });
  const invitationFlow = redirect?.startsWith("/accept-invite/") ?? false;
  const allowSignUp = registration.data === "bootstrap" || invitationFlow;
  const mode = modeParam === "signup" && allowSignUp ? "sign-up" : "sign-in";
  const setMode = (next: "sign-in" | "sign-up") =>
    void navigate({
      search: (prev) => ({ ...prev, mode: next === "sign-up" ? "signup" : undefined }),
      replace: true,
    });

  return (
    <AuthLayout
      // "Welcome back" presumes a returning user — untrue on a fresh install
      // with zero accounts. Detecting that state needs a first-run
      // create-admin flow (backend user-count check), which is out of scope
      // here; this is the trivial neutral-copy fix in the meantime.
      eyebrow={mode === "sign-in" ? "Sign in" : "Get started"}
      headline={
        mode === "sign-in" ? (
          <>
            Ship your stack.
            <br />
            <span className="font-normal text-muted-foreground">Sign in to deploy.</span>
          </>
        ) : (
          <>
            One account.
            <br />
            <span className="font-normal text-muted-foreground">Every deploy.</span>
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
        <SignInForm allowSignUp={allowSignUp} onSwitchToSignUp={() => setMode("sign-up")} />
      ) : (
        <SignUpForm
          bootstrap={registration.data === "bootstrap"}
          onSwitchToSignIn={() => setMode("sign-in")}
        />
      )}
    </AuthLayout>
  );
}
