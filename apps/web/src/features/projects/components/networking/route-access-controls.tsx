/**
 * Reusable access-control sections for a single protected HTTP route:
 * guest email invites (one-time code + session duration), a shareable
 * no-login link, and a CI bypass-header token. Shared by the Routes-tab
 * protection dialog and the Networking → Access tab so both surfaces stay
 * in sync. These controls only take effect while the route's auth wall
 * (deployment protection) is on.
 *
 * Sizing convention: every interactive control in here is h-8 / text-[12px]
 * so rows line up; each "Generate" action is preceded by an explicit
 * "Expires in <duration>" picker so the lifetime is chosen, not assumed.
 */

import { useState } from "react";
import {
  Copy01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { toast } from "sonner";

import { createId, ID_PREFIX, type ProxyRouteId } from "@otterdeploy/shared/id";

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
import { cn } from "@/shared/lib/utils";
import { routeGuestsCollection } from "@/features/projects/data/proxy-routes";
import { orpc } from "@/shared/server/orpc";

// Mirrors the server's zod .email() so a bad address is flagged before the
// round-trip instead of returning a generic "Input validation failed" toast.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GUEST_DURATIONS = [
  { label: "1 hour", hours: 1 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

export const SHARE_LINK_DURATIONS = [
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

export const BYPASS_TOKEN_DURATIONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "1 year", days: 365 },
] as const;

// Base UI's <SelectValue> shows the selected value's *label* only when the root
// is given an items map; without it the trigger renders the raw value ("24").
const GUEST_ITEMS = GUEST_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.hours),
}));
const SHARE_LINK_ITEMS = SHARE_LINK_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.hours),
}));
const BYPASS_TOKEN_ITEMS = BYPASS_TOKEN_DURATIONS.map((d) => ({
  label: d.label,
  value: String(d.days),
}));

/** Read-only label for an already-invited guest's session length. */
function guestDurationLabel(hours: number): string {
  const known = GUEST_DURATIONS.find((d) => d.hours === hours);
  if (known) return known.label;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Guests + shareable link + CI token, stacked. The whole access surface
 *  for one route, used inline (Access tab) or inside a dialog (Routes tab). */
export function RouteAccessControls({ routeId }: { routeId: string }) {
  return (
    <div className="flex flex-col divide-y">
      <div className="pb-5">
        <GuestsSection routeId={routeId} />
      </div>
      <div className="py-5">
        <ShareLinkSection routeId={routeId} />
      </div>
      <div className="pt-5">
        <BypassTokenSection routeId={routeId} />
      </div>
    </div>
  );
}

/** Small label + one-line description that heads each section. */
function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-[13px] font-medium">{title}</Label>
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Shared duration picker — "Expires in <select>" — keeps the link/token rows
 *  identical and makes the lifetime explicit before generating. */
function DurationSelect({
  items,
  value,
  onChange,
}: {
  items: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-muted-foreground">Expires in</span>
      <Select items={items} value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="h-8 w-[104px] text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function GuestsSection({ routeId }: { routeId: string }) {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("24");
  const [adding, setAdding] = useState(false);

  const { data: rows } = useLiveQuery(
    (q) =>
      q
        .from({ g: routeGuestsCollection })
        .where(({ g }) => eq(g.routeId, routeId as ProxyRouteId)),
    [routeId],
  );

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const showEmailError = trimmedEmail.length > 0 && !emailValid;

  // Optimistic invite — the form closes the instant the row lands in the
  // collection; tanstack/db rolls it back (with a toast) if the server rejects.
  // No per-invite pending flag: `adding` is purely the form's open/closed state.
  const onAdd = () => {
    if (!emailValid) return;
    const tx = routeGuestsCollection.insert({
      id: createId(ID_PREFIX.deploymentGuest),
      routeId: routeId as ProxyRouteId,
      email: trimmedEmail.toLowerCase(),
      sessionHours: Number(hours),
      createdAt: new Date().toISOString(),
    });
    setEmail("");
    setAdding(false);
    tx.isPersisted.promise.catch((err) =>
      toast.error(err instanceof Error ? err.message : "Failed to invite"),
    );
  };
  const onRemove = (guestId: string) => {
    const tx = routeGuestsCollection.delete(guestId);
    tx.isPersisted.promise.catch((err) =>
      toast.error(err instanceof Error ? err.message : "Failed to remove"),
    );
  };
  const cancelAdd = () => {
    setEmail("");
    setAdding(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Guests"
        hint="Invite people by email — they get a one-time code to sign in, no account, for the session length you pick."
      />

      <div className="overflow-hidden rounded-md border">
        {rows.length === 0 && !adding ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            No guests invited yet.
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {rows.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                  {g.email}
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {guestDurationLabel(g.sessionHours)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(g.id)}
                  aria-label="Remove guest"
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40 bg-muted/20 px-3 py-2">
          {adding ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAdd();
                    if (e.key === "Escape") cancelAdd();
                  }}
                  placeholder="guest@example.com"
                  aria-invalid={showEmailError}
                  className={cn(
                    "h-7 min-w-0 flex-1 font-mono text-[12.5px]",
                    showEmailError && "border-destructive focus-visible:ring-destructive/30",
                  )}
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <Select
                  items={GUEST_ITEMS}
                  value={hours}
                  onValueChange={(v) => setHours(v ?? "24")}
                >
                  <SelectTrigger className="h-7 w-[104px] text-[12px]">
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
                  className="h-7"
                  onClick={onAdd}
                  disabled={!emailValid}
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={cancelAdd}>
                  Cancel
                </Button>
              </div>
              {showEmailError ? (
                <p className="text-[11.5px] text-destructive">
                  Enter a valid email address.
                </p>
              ) : null}
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-[12px]"
              onClick={() => setAdding(true)}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
              Add guest
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function ShareLinkSection({ routeId }: { routeId: string }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [hours, setHours] = useState("72");
  const createShareLink = useMutation({
    ...orpc.project.proxyRoute.createShareLink.mutationOptions(),
    onSuccess: (res) => setShareUrl(res.url),
    onError: (err) => toast.error(err.message ?? "Failed to create link"),
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Shareable link"
        hint="A no-login URL anyone can open until it expires."
      />
      {shareUrl ? (
        <CopyField value={shareUrl} onReset={() => setShareUrl(null)} />
      ) : (
        <div className="flex items-center gap-2">
          <DurationSelect items={SHARE_LINK_ITEMS} value={hours} onChange={setHours} />
          <Button
            size="sm"
            className="h-8"
            disabled={createShareLink.isPending}
            onClick={() =>
              createShareLink.mutate({
                routeId: routeId as never,
                expiresInHours: Number(hours),
              })
            }
          >
            Generate link
          </Button>
        </div>
      )}
    </section>
  );
}

export function BypassTokenSection({ routeId }: { routeId: string }) {
  const [bypassToken, setBypassToken] = useState<string | null>(null);
  const [days, setDays] = useState("90");
  const createBypassToken = useMutation({
    ...orpc.project.proxyRoute.createBypassToken.mutationOptions(),
    onSuccess: (res) => setBypassToken(res.token),
    onError: (err) => toast.error(err.message ?? "Failed to create token"),
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="CI bypass token"
        hint="Send as the x-otter-bypass request header to skip the wall in automation."
      />
      {bypassToken ? (
        <CopyField value={bypassToken} onReset={() => setBypassToken(null)} />
      ) : (
        <div className="flex items-center gap-2">
          <DurationSelect items={BYPASS_TOKEN_ITEMS} value={days} onChange={setDays} />
          <Button
            size="sm"
            className="h-8"
            disabled={createBypassToken.isPending}
            onClick={() =>
              createBypassToken.mutate({
                routeId: routeId as never,
                expiresInDays: Number(days),
              })
            }
          >
            Generate token
          </Button>
        </div>
      )}
    </section>
  );
}

export function CopyField({
  value,
  onReset,
}: {
  value: string;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className="h-8 font-mono text-[12px]" />
      <Button
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copied to clipboard");
        }}
        aria-label="Copy"
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.8} className="size-3.5" />
      </Button>
      {onReset ? (
        <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={onReset}>
          New
        </Button>
      ) : null}
    </div>
  );
}
