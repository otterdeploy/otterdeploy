import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

// Pairing page for the CLI's device-authorization flow (RFC 8628).
// CLI prints a `user_code` and links the user here; they confirm or deny it
// while signed in to the web app.
const zSearch = z.object({ user_code: z.string().optional() });

export const Route = createFileRoute("/device")({
  validateSearch: zSearch,
  beforeLoad: async ({ search }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      const next = search.user_code ? `/device?user_code=${search.user_code}` : "/device";
      throw redirect({ to: "/sign-in", search: { redirect: next } });
    }
  },
  component: DevicePairingPage,
});

function DevicePairingPage() {
  const { user_code: prefilled } = Route.useSearch();
  const [code, setCode] = useState(prefilled ?? "");
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  const approve = useMutation({
    mutationFn: async (userCode: string) => {
      const result = await authClient.device.approve({ userCode });
      if (result.error) throw new Error(result.error.error_description ?? "Could not approve");
      return result.data;
    },
    onSuccess: () => setDone("approved"),
  });

  const deny = useMutation({
    mutationFn: async (userCode: string) => {
      const result = await authClient.device.deny({ userCode });
      if (result.error) throw new Error(result.error.error_description ?? "Could not deny");
      return result.data;
    },
    onSuccess: () => setDone("denied"),
  });

  if (done === "approved") {
    return (
      <Shell title="Device authorized">
        <p className="text-sm text-muted-foreground">
          You can close this window and return to the CLI.
        </p>
      </Shell>
    );
  }

  if (done === "denied") {
    return (
      <Shell title="Device denied">
        <p className="text-sm text-muted-foreground">No token was issued.</p>
      </Shell>
    );
  }

  const busy = approve.isPending || deny.isPending;
  const error = approve.error?.message ?? deny.error?.message;

  return (
    <Shell title="Authorize a device">
      <p className="text-sm text-muted-foreground">
        Confirm the code shown in your CLI to grant it access to your account.
      </p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <FieldLabel htmlFor="user_code">Code</FieldLabel>
        <Input
          id="user_code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </Field>

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || code.length === 0}
          onClick={() => approve.mutate(code)}
          className="flex-1"
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || code.length === 0}
          onClick={() => deny.mutate(code)}
          className="flex-1"
        >
          Deny
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-background p-6">
      <div className="mx-4 w-full max-w-[420px] rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
