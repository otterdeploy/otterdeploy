import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@otterdeploy/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@otterdeploy/ui/components/ui/field";
import { Input } from "@otterdeploy/ui/components/ui/input";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/device")({
  component: DevicePage,
  validateSearch: (search: Record<string, unknown>) => ({
    user_code: (search.user_code as string) ?? "",
  }),
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      // throw redirect({ to: "/login" });
    }
  },
});

function DevicePage() {
  const { user_code } = Route.useSearch();
  const [code, setCode] = useState(user_code);
  const [status, setStatus] = useState<"idle" | "loading" | "approved" | "denied">("idle");
  const [error, setError] = useState("");

  async function handleApprove() {
    if (!code.trim()) {
      setError("Please enter the code displayed in your terminal.");
      return;
    }

    setError("");
    setStatus("loading");

    const { error: approveError } = await authClient.device.approve({
      userCode: code.trim(),
    });

    if (approveError) {
      setStatus("idle");
      setError(
        approveError.error_description ?? "Failed to approve device. Check the code and try again.",
      );
      toast.error("Authorization failed");
      return;
    }

    setStatus("approved");
    toast.success("Device authorized");
  }

  async function handleDeny() {
    if (!code.trim()) {
      setError("Please enter the code displayed in your terminal.");
      return;
    }

    setError("");
    setStatus("loading");

    const { error: denyError } = await authClient.device.deny({
      userCode: code.trim(),
    });

    if (denyError) {
      setStatus("idle");
      setError(denyError.error_description ?? "Failed to deny device.");
      return;
    }

    setStatus("denied");
    toast.success("Device denied");
  }

  if (status === "approved") {
    return (
      <DevicePageShell>
        <FieldGroup>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
              <svg
                className="size-6 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Device Authorized</h1>
            <p className="text-muted-foreground text-sm text-balance">
              The CLI has been authorized. You can close this page and return to your terminal.
            </p>
          </div>
        </FieldGroup>
      </DevicePageShell>
    );
  }

  if (status === "denied") {
    return (
      <DevicePageShell>
        <FieldGroup>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
              <svg
                className="size-6 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Device Denied</h1>
            <p className="text-muted-foreground text-sm text-balance">
              The authorization request was denied. You can close this page.
            </p>
          </div>
        </FieldGroup>
      </DevicePageShell>
    );
  }

  return (
    <DevicePageShell>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Authorize Device</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Enter the code displayed in your terminal to authorize the CLI.
          </p>
        </div>

        <Field>
          <FieldLabel htmlFor="user_code">Device Code</FieldLabel>
          <Input
            id="user_code"
            name="user_code"
            type="text"
            placeholder="ABCD-1234"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError("");
            }}
            autoFocus
            className="text-center text-lg tracking-widest"
          />
          {error && <FieldError errors={[{ message: error }]} />}
        </Field>

        <Field>
          <Button
            type="button"
            className="w-full"
            disabled={status === "loading"}
            onClick={handleApprove}
          >
            {status === "loading" ? "Authorizing..." : "Approve"}
          </Button>
        </Field>

        <Field>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={status === "loading"}
            onClick={handleDeny}
          >
            Deny
          </Button>
        </Field>
      </FieldGroup>
    </DevicePageShell>
  );
}

function DevicePageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md" />
            Otterstack
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>

      <div className="bg-muted relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.28),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,hsl(var(--foreground)/0.12),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(155deg,hsl(var(--background)),hsl(var(--muted))_45%,hsl(var(--background)))]" />
        <div className="absolute inset-0 p-12">
          <div className="border-border/60 bg-background/70 text-foreground max-w-sm rounded-2xl border p-6 shadow-lg backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Device Authorization
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight">
              Authorize the Otterdeploy CLI.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Confirm the code from your terminal to securely connect the CLI to your account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
