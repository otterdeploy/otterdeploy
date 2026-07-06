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
 *
 * The Guests section lives in ./route-access-guests; shared constants +
 * small presentational pieces in ./route-access-shared.
 */

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

import { GuestsSection } from "./route-access-guests";
import {
  BYPASS_TOKEN_ITEMS,
  CopyField,
  DurationSelect,
  SectionHeader,
  SHARE_LINK_ITEMS,
} from "./route-access-shared";

/** Guests + shareable link + CI token, stacked. The whole access surface
 *  for one route, used inline (Access tab) or inside a dialog (Routes tab). */
export function RouteAccessControls({ routeId }: { routeId: string }) {
  return (
    <div className="flex flex-col divide-y">
      <div className="pb-5">
        <GuestsSection routeId={routeId} />
      </div>
      <div className="py-5">
        <PinSection routeId={routeId} />
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

const PIN_RE = /^\d{4,8}$/;

/** Access PIN — one shared numeric code anyone on the wall can enter. Set /
 *  rotate / remove; the PIN itself is write-only (never read back). */
function PinSection({ routeId }: { routeId: string }) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);

  const statusOptions = orpc.project.proxyRoute.accessPin.queryOptions({
    input: { routeId: routeId as never },
  });
  const status = useQuery(statusOptions);
  const enabled = status.data?.enabled ?? false;

  const setAccessPin = useMutation({
    ...orpc.project.proxyRoute.setAccessPin.mutationOptions(),
    onSuccess: (res) => {
      queryClient.setQueryData(statusOptions.queryKey, res);
      setPin("");
      setEditing(false);
      toast.success(res.enabled ? "Access PIN saved" : "Access PIN removed");
    },
    onError: (err) => toast.error(err.message ?? "Failed to update PIN"),
  });

  const pinValid = PIN_RE.test(pin);
  const showPinError = pin.length > 0 && !pinValid;
  const save = () => {
    if (!pinValid) return;
    setAccessPin.mutate({ routeId: routeId as never, pin });
  };
  const cancel = () => {
    setPin("");
    setEditing(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Access PIN"
        hint="One shared numeric code (4–8 digits) anyone can enter on the wall. Rotating or removing it signs every PIN session out."
      />
      {enabled && !editing ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12.5px] text-muted-foreground">••••••</span>
          <span className="text-[11.5px] text-muted-foreground">PIN is set</span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(true)}>
            Rotate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground hover:text-destructive"
            disabled={setAccessPin.isPending}
            onClick={() => setAccessPin.mutate({ routeId: routeId as never, pin: null })}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
              inputMode="numeric"
              placeholder="e.g. 482913"
              aria-invalid={showPinError}
              className="h-8 w-40 font-mono text-[12.5px] tracking-[0.2em]"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              size="sm"
              className="h-8"
              disabled={!pinValid || setAccessPin.isPending}
              onClick={save}
            >
              {enabled ? "Save new PIN" : "Set PIN"}
            </Button>
            {editing ? (
              <Button size="sm" variant="ghost" className="h-8" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
          </div>
          {showPinError ? (
            <p className="text-[11.5px] text-destructive">PIN must be 4–8 digits.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ShareLinkSection({ routeId }: { routeId: string }) {
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

function BypassTokenSection({ routeId }: { routeId: string }) {
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
