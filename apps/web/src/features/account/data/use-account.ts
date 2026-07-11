/**
 * Account-page data hooks — the signed-in user's session, linked accounts and
 * device sessions, all straight from the better-auth client. Query keys are
 * shared with the shell's account dialogs (`["auth", …]`) so the page and the
 * dialogs read/invalidate one cache.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";

export interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The live session (user + session token). Fresher than the router context
 *  snapshot — carries `twoFactorEnabled` and reflects profile edits. */
export function useCurrentSession() {
  return useQuery({
    queryKey: ["auth", "current-session"],
    queryFn: async () => (await authClient.getSession()).data,
  });
}

/** Linked sign-in methods. `credential` in the list means the user has a
 *  password — the gate for change-password and TOTP two-factor. */
export function useLinkedAccounts() {
  return useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const res = await authClient.listAccounts();
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load linked accounts");
      }
      return res.data ?? [];
    },
  });
}

/** Every device session for the user (the same source as the shell dialog). */
export function useSessions() {
  return useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async (): Promise<SessionRow[]> => {
      const res = await authClient.listSessions();
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load sessions");
      }
      return (res.data ?? []) as SessionRow[];
    },
  });
}

/** Invalidators for the shared auth cache. */
export function useAuthInvalidate() {
  const qc = useQueryClient();
  return {
    session: () => qc.invalidateQueries({ queryKey: ["auth", "current-session"] }),
    sessions: () => qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  };
}

/** Coarse "Browser on OS" label from a user-agent string. Best-effort — used
 *  for display only, never for any decision. */
export function describeAgent(ua: string | null | undefined): string {
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
  // iOS before macOS: iPhone/iPad UAs also contain "like Mac OS X".
  // Android before Linux: Android UAs also contain "Linux".
  const os = /windows/i.test(ua)
    ? "Windows"
    : /iphone|ipad|ios/i.test(ua)
      ? "iOS"
      : /mac os|macintosh/i.test(ua)
        ? "macOS"
        : /android/i.test(ua)
          ? "Android"
          : /linux/i.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
