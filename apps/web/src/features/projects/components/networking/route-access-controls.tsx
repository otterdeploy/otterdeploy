/**
 * Reusable access-control sections for a single protected HTTP route:
 * guest email invites (one-time code + session duration), a shareable
 * no-login link, and a CI bypass-header token. Shared by the Routes-tab
 * protection dialog and the Networking → Access tab so both surfaces stay
 * in sync. These controls only take effect while the route's auth wall
 * (deployment protection) is on.
 */

import { useState } from "react";
import { Copy01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc, queryClient } from "@/shared/server/orpc";

export const GUEST_DURATIONS = [
  { label: "1 hour", hours: 1 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

/** Guests + shareable link + CI token, stacked. The whole access surface
 *  for one route, used inline (Access tab) or inside a dialog (Routes tab). */
export function RouteAccessControls({ routeId }: { routeId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <GuestsSection routeId={routeId} />
      <ShareLinkSection routeId={routeId} />
      <BypassTokenSection routeId={routeId} />
    </div>
  );
}

export function GuestsSection({ routeId }: { routeId: string }) {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("24");

  const guests = useQuery(
    orpc.project.proxyRoute.listGuests.queryOptions({
      input: { routeId: routeId as never },
    }),
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.project.proxyRoute.listGuests.queryKey({
        input: { routeId: routeId as never },
      }),
    });

  const invite = useMutation({
    ...orpc.project.proxyRoute.inviteGuest.mutationOptions(),
    onSuccess: () => {
      setEmail("");
      void refresh();
    },
    onError: (err) => toast.error(err.message ?? "Failed to invite"),
  });
  const remove = useMutation({
    ...orpc.project.proxyRoute.removeGuest.mutationOptions(),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(err.message ?? "Failed to remove"),
  });

  const rows = guests.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <Label className="text-[13px]">Guests</Label>
      <p className="text-[12px] text-muted-foreground">
        External people you invite by email get a one-time code to sign in — no
        account, time-boxed to the session length you set.
      </p>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-[12px]">{g.email}</span>
              <Select
                value={String(g.sessionHours)}
                onValueChange={(v) =>
                  invite.mutate({
                    routeId: routeId as never,
                    email: g.email,
                    sessionHours: Number(v),
                  })
                }
              >
                <SelectTrigger className="h-7 w-[104px] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GUEST_DURATIONS.map((d) => (
                    <SelectItem key={d.hours} value={String(d.hours)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                onClick={() => remove.mutate({ routeId: routeId as never, guestId: g.id })}
                aria-label="Remove guest"
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={email}
          type="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-8 flex-1 text-[12px]"
        />
        <Select value={hours} onValueChange={(v) => setHours(v ?? "24")}>
          <SelectTrigger className="h-8 w-[104px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUEST_DURATIONS.map((d) => (
              <SelectItem key={d.hours} value={String(d.hours)}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!email.trim() || invite.isPending}
          onClick={() =>
            invite.mutate({
              routeId: routeId as never,
              email: email.trim(),
              sessionHours: Number(hours),
            })
          }
        >
          Invite
        </Button>
      </div>
    </section>
  );
}

export function ShareLinkSection({ routeId }: { routeId: string }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const createShareLink = useMutation({
    ...orpc.project.proxyRoute.createShareLink.mutationOptions(),
    onSuccess: (res) => setShareUrl(res.url),
    onError: (err) => toast.error(err.message ?? "Failed to create link"),
  });

  return (
    <section className="flex flex-col gap-2">
      <Label className="text-[13px]">Shareable link</Label>
      {shareUrl ? (
        <CopyField value={shareUrl} />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={createShareLink.isPending}
          onClick={() =>
            createShareLink.mutate({ routeId: routeId as never, expiresInHours: 72 })
          }
        >
          Generate 72-hour link
        </Button>
      )}
    </section>
  );
}

export function BypassTokenSection({ routeId }: { routeId: string }) {
  const [bypassToken, setBypassToken] = useState<string | null>(null);
  const createBypassToken = useMutation({
    ...orpc.project.proxyRoute.createBypassToken.mutationOptions(),
    onSuccess: (res) => setBypassToken(res.token),
    onError: (err) => toast.error(err.message ?? "Failed to create token"),
  });

  return (
    <section className="flex flex-col gap-2">
      <Label className="text-[13px]">CI bypass token</Label>
      <p className="text-[12px] text-muted-foreground">
        Send as the{" "}
        <span className="font-mono text-foreground/80">x-otter-bypass</span> request
        header to skip the wall in automation.
      </p>
      {bypassToken ? (
        <CopyField value={bypassToken} />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={createBypassToken.isPending}
          onClick={() =>
            createBypassToken.mutate({ routeId: routeId as never, expiresInDays: 90 })
          }
        >
          Generate 90-day token
        </Button>
      )}
    </section>
  );
}

export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className="font-mono text-[12px]" />
      <Button
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copied to clipboard");
        }}
        aria-label="Copy"
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.8} className="size-3.5" />
      </Button>
    </div>
  );
}
