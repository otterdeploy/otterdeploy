import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { AuthLayout } from "@/features/auth/components/auth-layout";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { fetchAuthPublicConfig } from "@/features/auth/data/registration-mode";

// `mode` is the URL's source of truth for the sign-in/sign-up toggle (was a
// local useState) — otherwise sharing a "create an account" link or hitting
// refresh mid-signup silently dumped the visitor back on Sign in with no way
// to deep-link straight to the form they wanted.
const zSearch = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/sign-in")({
  staticData: { crumb: "Sign in" },
  validateSearch: zSearch,
  component: SignInPage,
});

function SignInPage() {
  const { mode: modeParam, redirect } = Route.useSearch();
  const navigate = Route.useNavigate();
  const registration = useQuery({
    queryKey: ["auth", "public-config"],
    queryFn: fetchAuthPublicConfig,
    staleTime: 0,
    retry: false,
  });
  const mode_ = registration.data?.mode;
  const invitationFlow = redirect?.startsWith("/accept-invite/") ?? false;
  // "open" is the operator opting into self-registration (Instance → Access);
  // "bootstrap" is the one-time first-account flow. Both surface the sign-up
  // form — only "bootstrap" also asks for the installer token.
  const allowSignUp = mode_ === "bootstrap" || mode_ === "open" || invitationFlow;
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
      headline={mode === "sign-in" ? "Ship your stack." : "Set up your stack."}
      subhead={
        mode === "sign-in"
          ? "Git-sourced builds, zero-downtime rollouts, and logs that tell the truth — on infrastructure you own."
          : "One account for every project, service and server running on this installation."
      }
    >
      {mode === "sign-in" ? (
        <SignInForm
          allowSignUp={allowSignUp}
          socialProviders={registration.data?.socialProviders ?? []}
          onSwitchToSignUp={() => setMode("sign-up")}
        />
      ) : (
        <SignUpForm
          bootstrap={mode_ === "bootstrap"}
          socialProviders={registration.data?.socialProviders ?? []}
          onSwitchToSignIn={() => setMode("sign-in")}
        />
      )}
    </AuthLayout>
  );
}
