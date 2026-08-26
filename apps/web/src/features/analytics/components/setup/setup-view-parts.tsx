/**
 * Setup view sections that write: the hosts editor and the privacy form.
 * Read-only sections (API doc, health counters) live in setup-health-doc.tsx.
 * Everything here is scoped to one project's site row.
 */

import { useState } from "react";

import { Cancel01Icon, Globe02Icon, SecurityIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface SiteRowLike {
  extraHosts: string[];
  excludePaths: string[];
  respectDnt: boolean;
  requireConsent: boolean;
}

const invalidateSite = () =>
  queryClient.invalidateQueries({ queryKey: orpc.analytics.site.get.key() });

export function HostsSection({
  projectId,
  allowedHosts,
  site,
}: {
  projectId: string;
  allowedHosts: readonly string[];
  site: SiteRowLike;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const update = useMutation(orpc.analytics.site.update.mutationOptions());

  const save = (extraHosts: string[]) =>
    update.mutate(
      { projectId, extraHosts },
      {
        onSuccess: () => {
          void invalidateSite();
          toast.success(t("analytics.setup.hostsSaved"));
        },
        onError: () => toast.error(t("analytics.setup.saveFailed")),
      },
    );

  const add = () => {
    const host = draft.trim().toLowerCase();
    if (host === "" || site.extraHosts.includes(host)) return;
    save([...site.extraHosts, host]);
    setDraft("");
  };

  return (
    <SettingsSection
      icon={Globe02Icon}
      title={t("analytics.setup.hosts")}
      description={t("analytics.setup.hostsDesc")}
    >
      <SettingsRow
        stacked
        title={t("analytics.setup.allowedHosts")}
        description={t("analytics.setup.allowedHostsDesc")}
        control={
          allowedHosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("analytics.setup.noHosts")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {allowedHosts.map((host) => (
                <li key={host} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[12px]">
                  {host}
                </li>
              ))}
            </ul>
          )
        }
      />
      <SettingsRow
        stacked
        title={t("analytics.setup.extraHosts")}
        description={t("analytics.setup.extraHostsDesc")}
        control={
          <div className="flex flex-col gap-2">
            {site.extraHosts.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {site.extraHosts.map((host) => (
                  <li
                    key={host}
                    className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 font-mono text-[12px]"
                  >
                    {host}
                    <button
                      type="button"
                      aria-label={t("analytics.setup.removeHost", { host })}
                      disabled={update.isPending}
                      onClick={() => save(site.extraHosts.filter((h) => h !== host))}
                      className="grid size-4.5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="app.example.com"
                aria-label={t("analytics.setup.extraHosts")}
                className="h-8 w-56 font-mono text-[12px]"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending || draft.trim() === ""}
                onClick={add}
              >
                {t("analytics.setup.addHost")}
              </Button>
            </div>
          </div>
        }
      />
    </SettingsSection>
  );
}

export function PrivacySection({ projectId, site }: { projectId: string; site: SiteRowLike }) {
  const { t } = useTranslation();
  const update = useMutation(orpc.analytics.site.update.mutationOptions());

  const form = useForm({
    defaultValues: {
      respectDnt: site.respectDnt,
      requireConsent: site.requireConsent,
      excludePaths: site.excludePaths.join("\n"),
    },
    onSubmit: ({ value }) => {
      const excludePaths = value.excludePaths
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      update.mutate(
        {
          projectId,
          respectDnt: value.respectDnt,
          requireConsent: value.requireConsent,
          excludePaths,
        },
        {
          onSuccess: () => {
            void invalidateSite();
            toast.success(t("analytics.setup.privacySaved"));
          },
          onError: () => toast.error(t("analytics.setup.saveFailed")),
        },
      );
    },
  });

  return (
    <SettingsSection
      icon={SecurityIcon}
      title={t("analytics.setup.privacy")}
      description={t("analytics.setup.privacyDesc")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="divide-y divide-border/60"
      >
        <form.Field name="respectDnt">
          {(field) => (
            <SettingsRow
              title={t("analytics.setup.respectDnt")}
              description={t("analytics.setup.respectDntDesc")}
              control={
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(next) => field.handleChange(next)}
                  aria-label={t("analytics.setup.respectDnt")}
                />
              }
            />
          )}
        </form.Field>
        <form.Field name="requireConsent">
          {(field) => (
            <SettingsRow
              title={t("analytics.setup.requireConsent")}
              description={t("analytics.setup.requireConsentDesc")}
              control={
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(next) => field.handleChange(next)}
                  aria-label={t("analytics.setup.requireConsent")}
                />
              }
            />
          )}
        </form.Field>
        <form.Field name="excludePaths">
          {(field) => (
            <SettingsRow
              stacked
              title={t("analytics.setup.excludePaths")}
              description={t("analytics.setup.excludePathsDesc")}
              control={
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={"/admin/*\n/preview/*"}
                  aria-label={t("analytics.setup.excludePaths")}
                  className="min-h-20 font-mono text-[12px]"
                />
              }
            />
          )}
        </form.Field>
        <SettingsFooter>
          <Button type="submit" size="sm" disabled={update.isPending}>
            {update.isPending ? t("analytics.setup.saving") : t("analytics.setup.save")}
          </Button>
        </SettingsFooter>
      </form>
    </SettingsSection>
  );
}
