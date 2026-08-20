/**
 * Guests section for the route access controls: email invites with a
 * one-time code + per-guest session length. Split out of
 * route-access-controls.tsx to keep that file under the max-lines cap.
 */

import { useState } from "react";

import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createId, ID_PREFIX, idSchema } from "@otterdeploy/shared/id";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { routeGuestsCollection } from "@/features/projects/data/proxy-routes";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import { EMAIL_RE, SectionHeader, useGuestItems, useHoursLabel } from "./route-access-shared";

function removeGuest(guestId: string, failMessage: string) {
  const tx = routeGuestsCollection.delete(guestId);
  tx.isPersisted.promise.catch((err) =>
    toast.error(err instanceof Error ? err.message : failMessage),
  );
}

/** Invited-guest rows. Split out of GuestsSection to keep it under the
 *  max-lines-per-function cap. */
function GuestList({
  rows,
  onRemove,
}: {
  rows: Array<{ id: string; email: string; sessionHours: number }>;
  onRemove: (guestId: string) => void;
}) {
  const { t } = useTranslation();
  const hoursLabel = useHoursLabel();
  return (
    <div className="divide-y divide-border/40">
      {rows.map((g) => (
        <div key={g.id} className="flex items-center gap-2 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{g.email}</span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground">
            {hoursLabel(g.sessionHours)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(g.id)}
            aria-label={t("routeAccess.guests.removeGuest")}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function GuestsSection({ routeId }: { routeId: string }) {
  const { t } = useTranslation();
  const guestItems = useGuestItems();
  const [adding, setAdding] = useState(false);

  // The panel hands over a plain string; brand it at this boundary once.
  const guestRouteId = idSchema.proxyRoute.parse(routeId);

  const { data: rows } = useLiveQuery(
    (q) => q.from({ g: routeGuestsCollection }).where(({ g }) => eq(g.routeId, guestRouteId)),
    [guestRouteId],
  );

  // Optimistic invite: the form closes the instant the row lands in the
  // collection; tanstack/db rolls it back (with a toast) if the server rejects.
  // No per-invite pending flag: `adding` is purely the form's open/closed state.
  const form = useForm({
    defaultValues: { email: "", hours: "24" },
    onSubmit: ({ value }) => {
      const trimmedEmail = value.email.trim();
      if (!EMAIL_RE.test(trimmedEmail)) return;
      const tx = routeGuestsCollection.insert({
        id: createId(ID_PREFIX.deploymentGuest),
        routeId: guestRouteId,
        email: trimmedEmail.toLowerCase(),
        sessionHours: Number(value.hours),
        createdAt: new Date().toISOString(),
      });
      form.resetField("email");
      setAdding(false);
      tx.isPersisted.promise.catch((err) =>
        toast.error(err instanceof Error ? err.message : t("routeAccess.guests.inviteFailed")),
      );
    },
  });

  const cancelAdd = () => {
    form.resetField("email");
    setAdding(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={t("routeAccess.guests.title")} hint={t("routeAccess.guests.hint")} />

      <div className="overflow-hidden rounded-md border">
        {rows.length === 0 && !adding ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            {t("routeAccess.guests.empty")}
          </div>
        ) : (
          <GuestList
            rows={rows}
            onRemove={(id) => removeGuest(id, t("routeAccess.guests.removeFailed"))}
          />
        )}

        <div className="border-t border-border/40 bg-muted/20 px-3 py-2">
          {adding ? (
            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => {
                  const trimmed = value.trim();
                  return trimmed.length > 0 && !EMAIL_RE.test(trimmed)
                    ? t("routeAccess.guests.emailInvalid")
                    : undefined;
                },
              }}
            >
              {(field) => {
                const showEmailError = field.state.meta.errors.length > 0;
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        type="email"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void form.handleSubmit();
                          if (e.key === "Escape") cancelAdd();
                        }}
                        placeholder="guest@example.com"
                        aria-label={t("routeAccess.guests.emailLabel")}
                        aria-invalid={showEmailError}
                        className={cn(
                          "h-8 min-w-0 flex-1 font-mono text-[12.5px]",
                          showEmailError && "border-destructive focus-visible:ring-destructive/30",
                        )}
                        spellCheck={false}
                        autoCapitalize="off"
                      />
                      <form.Field name="hours">
                        {(hoursField) => (
                          <Select
                            items={guestItems}
                            value={hoursField.state.value}
                            onValueChange={(v) => hoursField.handleChange(v ?? "24")}
                          >
                            <SelectTrigger className="h-8 w-[104px] text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {guestItems.map((it) => (
                                <SelectItem key={it.value} value={it.value}>
                                  {it.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </form.Field>
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => void form.handleSubmit()}
                        disabled={!EMAIL_RE.test(field.state.value.trim())}
                      >
                        {t("common.add")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={cancelAdd}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                    {showEmailError ? (
                      <p className="text-[11.5px] text-destructive">
                        {t("routeAccess.guests.emailInvalid")}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() => setAdding(true)}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
              {t("routeAccess.guests.addGuest")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
