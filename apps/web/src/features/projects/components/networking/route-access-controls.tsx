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

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
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
        <ShareLinkSection routeId={routeId} />
      </div>
      <div className="pt-5">
        <BypassTokenSection routeId={routeId} />
      </div>
    </div>
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
