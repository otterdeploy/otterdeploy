/**
 * "Sign in with SSO" — the enterprise-identity-provider entry point on the
 * sign-in page.
 *
 * Distinct from `SocialSignIn` next to it: that renders a fixed set of buttons
 * for social providers the INSTALL has configured (GitHub, Google, GitLab).
 * This one is per-workspace and discovered at runtime — the user types an email,
 * the server matches its domain against a registered `sso_provider` row and
 * redirects to whichever IdP owns it. There is nothing to render a button for
 * up front, because the set of providers is a property of the address.
 *
 * Collapsed to a single link by default. Most people on most installs sign in
 * with a password, and a permanently-expanded second email field on the sign-in
 * page would imply otherwise.
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export function EnterpriseSsoSignIn() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  const start = useMutation({
    mutationFn: async (address: string) => {
      const result = await authClient.signIn.sso({
        email: address,
        callbackURL: `${window.location.origin}/`,
        // Where the IdP sends someone whose domain resolves but whose sign-in
        // the provider then rejects. Without it they land on a blank page with
        // no way back to the form.
        errorCallbackURL: `${window.location.origin}/sign-in`,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? result.error.statusText ?? "No SSO provider for that domain",
        );
      }
      return result.data;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't start SSO sign-in");
    },
  });

  if (!open) {
    return (
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Sign in with SSO
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed.includes("@")) {
          toast.error("Enter your work email address");
          return;
        }
        start.mutate(trimmed);
      }}
    >
      <Label htmlFor="sso-email" className="text-[13px]">
        Work email
      </Label>
      <div className="flex gap-2">
        <Input
          id="sso-email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@acme.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={start.isPending}>
          {start.isPending ? "…" : "Continue"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        You'll be redirected to your organization's identity provider.
      </p>
    </form>
  );
}
