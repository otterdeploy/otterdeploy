/**
 * Account danger zone — "sign out everywhere": revoke every session for this
 * user (better-auth `revokeSessions`, which includes the current one), clear
 * the local cookie via signOut, and land on the sign-in page. Confirmed
 * through an alert dialog since it kicks the user out of this very tab.
 */

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsSection } from "@/shared/components/settings-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

export function DangerCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOutEverywhere = useMutation({
    mutationFn: async () => {
      const res = await authClient.revokeSessions();
      if (res.error) throw new Error(res.error.message ?? "Failed to revoke sessions");
      // The current session is already revoked server-side; signOut just clears
      // the local cookie. A failure here is harmless, so don't surface it.
      await authClient.signOut().catch(() => undefined);
    },
    onSuccess: () => {
      // Every cached query belongs to the account that just signed out — drop
      // the whole cache so nothing leaks into the next sign-in.
      queryClient.clear();
      void navigate({ to: "/sign-in", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to sign out everywhere"),
  });

  return (
    <SettingsSection
      icon={Alert02Icon}
      title="Danger zone"
      description="Actions that end access for this account."
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-destructive">Sign out everywhere</span>
          <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
            Revokes every session on every device — including this one. You'll be returned to the
            sign-in page.
          </span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              />
            }
          >
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5" />
            Sign out everywhere
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
              <AlertDialogDescription>
                Every device signed in to your account — including this one — will be signed out
                immediately. You'll need to sign in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm" disabled={signOutEverywhere.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                size="sm"
                disabled={signOutEverywhere.isPending}
                onClick={() => signOutEverywhere.mutate()}
              >
                {signOutEverywhere.isPending ? "Signing out…" : "Sign out everywhere"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsSection>
  );
}
