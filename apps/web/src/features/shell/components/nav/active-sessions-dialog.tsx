import { formatRelative } from "@otterdeploy/shared/format";
/**
 * Active sessions — list the signed-in user's sessions and revoke them. Backed
 * entirely by better-auth's session APIs (`listSessions` / `revokeSession` /
 * `revokeOtherSessions`); the current session is marked "This device".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { authQueryKeys } from "@/lib/auth-query-keys";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Spinner } from "@/shared/components/ui/spinner";

interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Coarse "Browser on OS" label from a user-agent string. Best-effort — used
 *  for display only, never for any decision. */
function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /edg/i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : /otterdeploy|\bbun\b|node|curl/i.test(ua)
            ? "CLI"
            : "Browser";
  const os = /windows/i.test(ua)
    ? "Windows"
    : /mac os|macintosh/i.test(ua)
      ? "macOS"
      : /android/i.test(ua)
        ? "Android"
        : /iphone|ipad|ios/i.test(ua)
          ? "iOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export function ActiveSessionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();

  const currentQ = useQuery({
    queryKey: authQueryKeys.currentSession,
    queryFn: async () => (await authClient.getSession()).data,
    enabled: open,
  });
  const sessionsQ = useQuery({
    queryKey: authQueryKeys.sessions,
    queryFn: async (): Promise<SessionRow[]> => {
      const res = await authClient.listSessions();
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load sessions");
      }
      return (res.data ?? []) as SessionRow[];
    },
    enabled: open,
  });

  const currentToken = currentQ.data?.session?.token;
  const invalidate = () => qc.invalidateQueries({ queryKey: authQueryKeys.sessions });

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const res = await authClient.revokeSession({ token });
      if (res.error) throw new Error(res.error.message ?? "Failed to revoke");
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Session revoked");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revoke"),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await authClient.revokeOtherSessions();
      if (res.error) throw new Error(res.error.message ?? "Failed");
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Signed out of all other sessions");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const sessions = sessionsQ.data ?? [];
  const otherCount = sessions.filter((s) => s.token !== currentToken).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Active sessions</DialogTitle>
          <DialogDescription>
            Devices currently signed in to your account. Revoke any you don't recognise.
          </DialogDescription>
        </DialogHeader>

        {sessionsQ.isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Loading sessions…
          </div>
        ) : sessionsQ.isError ? (
          <ErrorState
            message={sessionsQ.error instanceof Error ? sessionsQ.error.message : undefined}
            onRetry={() => void sessionsQ.refetch()}
          />
        ) : (
          <ul className="flex max-h-80 flex-col divide-y divide-border/60 overflow-y-auto">
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {describeAgent(s.userAgent)}
                      </span>
                      {isCurrent && <Badge variant="secondary">This device</Badge>}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {s.ipAddress || "unknown IP"} · active {formatRelative(s.updatedAt)}
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revokeOne.isPending}
                      onClick={() => revokeOne.mutate(s.token)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={otherCount === 0 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {revokeOthers.isPending
              ? "Signing out…"
              : `Sign out ${otherCount} other session${otherCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
