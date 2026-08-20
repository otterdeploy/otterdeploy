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
 * All copy comes from the `routeAccess` i18n namespace.
 *
 * The Guests section lives in ./route-access-guests; shared constants +
 * small presentational pieces in ./route-access-shared.
 */

import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

import { GuestsSection } from "./route-access-guests";
import {
  CopyField,
  DurationSelect,
  SectionHeader,
  useBypassTokenItems,
  useShareLinkItems,
} from "./route-access-shared";

/**
 * The whole access surface for one route, used inline (Access tab) or inside
 * a dialog (Routes tab). Two panes on wide viewports. PEOPLE (guest invites)
 * on the left, the three CREDENTIAL mechanisms (PIN / link / token) stacked
 * on the right: so the dialog reads as two short columns instead of one
 * long scroll. Collapses back to a single stack under `md`.
 */
export function RouteAccessControls({ routeId }: { routeId: string }) {
  return (
    <div className="grid grid-cols-1 gap-y-5 md:grid-cols-[1fr_1px_1fr] md:gap-x-7">
      <div>
        <GuestsSection routeId={routeId} />
      </div>
      <div className="hidden bg-border md:block" />
      <div className="flex flex-col divide-y">
        <div className="pb-5">
          <PinSection routeId={routeId} />
        </div>
        <div className="py-5">
          <ShareLinkSection routeId={routeId} />
        </div>
        <div className="pt-5">
          <BypassTokenSection routeId={routeId} />
        </div>
      </div>
    </div>
  );
}

const PIN_RE = /^\d{4,8}$/;

/** Access PIN: one shared numeric code anyone on the wall can enter. Set /
 *  rotate / remove; the PIN itself is write-only (never read back). */
function PinSection({ routeId }: { routeId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const statusOptions = orpc.project.proxyRoute.accessPin.queryOptions({
    input: { routeId },
  });
  const status = useQuery(statusOptions);
  const enabled = status.data?.enabled ?? false;

  const setAccessPin = useMutation({
    ...orpc.project.proxyRoute.setAccessPin.mutationOptions(),
    onSuccess: (res) => {
      queryClient.setQueryData(statusOptions.queryKey, res);
      form.reset();
      setEditing(false);
      toast.success(res.enabled ? t("routeAccess.pin.saved") : t("routeAccess.pin.removed"));
    },
    onError: (err) => toast.error(err.message ?? t("routeAccess.pin.updateFailed")),
  });

  const form = useForm({
    defaultValues: { pin: "" },
    onSubmit: ({ value }) => {
      if (!PIN_RE.test(value.pin)) return;
      setAccessPin.mutate({ routeId, pin: value.pin });
    },
  });

  const cancel = () => {
    form.reset();
    setEditing(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={t("routeAccess.pin.title")} hint={t("routeAccess.pin.hint")} />
      {enabled && !editing ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12.5px] text-muted-foreground">••••••</span>
          <span className="text-[11.5px] text-muted-foreground">{t("routeAccess.pin.isSet")}</span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(true)}>
            {t("routeAccess.pin.rotate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground hover:text-destructive"
            disabled={setAccessPin.isPending}
            onClick={() => setAccessPin.mutate({ routeId, pin: null })}
          >
            {t("common.remove")}
          </Button>
        </div>
      ) : (
        <form.Field
          name="pin"
          validators={{
            onChange: ({ value }) =>
              value.length > 0 && !PIN_RE.test(value) ? t("routeAccess.pin.invalid") : undefined,
          }}
        >
          {(field) => {
            const showPinError = field.state.meta.errors.length > 0;
            return (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(e.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void form.handleSubmit();
                      if (e.key === "Escape") cancel();
                    }}
                    inputMode="numeric"
                    // The wide tracking previews PIN spacing on typed digits;
                    // prose spaced out reads as broken, so the placeholder is
                    // digits only and tracks normally.
                    placeholder="482913"
                    aria-label={t("routeAccess.pin.title")}
                    aria-invalid={showPinError}
                    className="h-8 w-40 font-mono text-[12.5px] tracking-[0.2em] placeholder:tracking-normal"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!PIN_RE.test(field.state.value) || setAccessPin.isPending}
                    onClick={() => void form.handleSubmit()}
                  >
                    {enabled ? t("routeAccess.pin.saveNew") : t("routeAccess.pin.set")}
                  </Button>
                  {editing ? (
                    <Button size="sm" variant="ghost" className="h-8" onClick={cancel}>
                      {t("common.cancel")}
                    </Button>
                  ) : null}
                </div>
                {showPinError ? (
                  <p className="text-[11.5px] text-destructive">{t("routeAccess.pin.invalid")}</p>
                ) : null}
              </div>
            );
          }}
        </form.Field>
      )}
    </section>
  );
}

function ShareLinkSection({ routeId }: { routeId: string }) {
  const { t } = useTranslation();
  const shareLinkItems = useShareLinkItems();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [hours, setHours] = useState("72");
  const createShareLink = useMutation({
    ...orpc.project.proxyRoute.createShareLink.mutationOptions(),
    onSuccess: (res) => setShareUrl(res.url),
    onError: (err) => toast.error(err.message ?? t("routeAccess.link.createFailed")),
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={t("routeAccess.link.title")} hint={t("routeAccess.link.hint")} />
      {shareUrl ? (
        <CopyField value={shareUrl} onReset={() => setShareUrl(null)} />
      ) : (
        <div className="flex items-center gap-2">
          <DurationSelect items={shareLinkItems} value={hours} onChange={setHours} />
          <Button
            size="sm"
            className="h-8"
            disabled={createShareLink.isPending}
            onClick={() =>
              createShareLink.mutate({
                routeId,
                expiresInHours: Number(hours),
              })
            }
          >
            {t("routeAccess.link.generate")}
          </Button>
        </div>
      )}
    </section>
  );
}

function BypassTokenSection({ routeId }: { routeId: string }) {
  const { t } = useTranslation();
  const bypassTokenItems = useBypassTokenItems();
  const [bypassToken, setBypassToken] = useState<string | null>(null);
  const [days, setDays] = useState("90");
  const createBypassToken = useMutation({
    ...orpc.project.proxyRoute.createBypassToken.mutationOptions(),
    onSuccess: (res) => setBypassToken(res.token),
    onError: (err) => toast.error(err.message ?? t("routeAccess.token.createFailed")),
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={t("routeAccess.token.title")} hint={t("routeAccess.token.hint")} />
      {bypassToken ? (
        <CopyField value={bypassToken} onReset={() => setBypassToken(null)} />
      ) : (
        <div className="flex items-center gap-2">
          <DurationSelect items={bypassTokenItems} value={days} onChange={setDays} />
          <Button
            size="sm"
            className="h-8"
            disabled={createBypassToken.isPending}
            onClick={() =>
              createBypassToken.mutate({
                routeId,
                expiresInDays: Number(days),
              })
            }
          >
            {t("routeAccess.token.generate")}
          </Button>
        </div>
      )}
    </section>
  );
}
