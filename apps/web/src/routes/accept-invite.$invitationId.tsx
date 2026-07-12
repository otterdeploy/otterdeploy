/**
 * Organization invitation acceptance. Reached from the invite email link
 * (/accept-invite/<invitationId>). Lives OUTSIDE the /_app guard on purpose:
 * a brand-new invitee has zero orgs, and the /_app guard would bounce them
 * to onboarding before they could accept. We require only a session here;
 * unauthenticated visitors are sent to sign-in and returned afterwards.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { authQueryKeys } from "@/lib/auth-query-keys";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";

export const Route = createFileRoute("/accept-invite/$invitationId")({
  beforeLoad: async ({ params }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/sign-in",
        search: { redirect: `/accept-invite/${params.invitationId}` },
      });
    }
  },
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { invitationId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const invitation = useQuery({
    queryKey: authQueryKeys.invitation(invitationId),
    queryFn: async () => {
      const res = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Invitation not found or expired");
      }
      return res.data;
    },
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      const res = await authClient.organization.acceptInvitation({ invitationId });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to accept invitation");
      }
      return res.data;
    },
    onSuccess: async (data) => {
      const organizationId = data?.invitation.organizationId;
      if (organizationId) {
        await authClient.organization.setActive({ organizationId });
      }
      toast.success("Invitation accepted");
      // Hard navigation so the /_app guard re-runs with the new membership
      // and lands on the now-active organization.
      window.location.href = "/";
    },
    onError: (err) => toast.error(err.message ?? "Failed to accept invitation"),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const res = await authClient.organization.rejectInvitation({ invitationId });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to decline invitation");
      }
      return res.data;
    },
    onSuccess: async () => {
      // The cached invitation still says "pending" — refetch so revisiting the
      // invite link shows its real (declined) state instead of the accept UI.
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.invitation(invitationId) });
      toast.success("Invitation declined");
      void navigate({ to: "/" });
    },
    onError: (err) => toast.error(err.message ?? "Failed to decline invitation"),
  });

  return (
    <div className="grid min-h-svh place-items-center bg-background p-6">
      <div className="w-full max-w-[420px] rounded-xl border bg-card p-6 shadow-sm">
        {invitation.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading invitation…
          </div>
        ) : invitation.isError ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div>
              <h1 className="text-lg font-semibold">Invitation unavailable</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">{invitation.error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
              Go to dashboard
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 text-center">
            <div>
              <h1 className="text-lg font-semibold">
                Join {invitation.data?.organizationName ?? "the workspace"}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                You&apos;ve been invited to collaborate as a{" "}
                <span className="font-medium text-foreground/80 capitalize">
                  {invitation.data?.role ?? "member"}
                </span>
                . Accepting grants access to every project in this workspace.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                disabled={reject.isPending || accept.isPending}
                onClick={() => reject.mutate()}
              >
                Decline
              </Button>
              <Button
                disabled={accept.isPending || reject.isPending}
                onClick={() => accept.mutate()}
              >
                Accept invitation
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
