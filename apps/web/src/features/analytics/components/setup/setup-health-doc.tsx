/**
 * Setup view read-only sections: the tracking API mini-doc and the collector
 * health counters. No mutations here; both explain, neither edits.
 */

import { Activity03Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@/shared/components/settings-section";

// ─── Tracking API mini-doc ─────────────────────────────────────────────────

const API_DOC = [
  { code: 'otter.track("signup", { plan: "pro" })', key: "analytics.setup.docTrack" },
  { code: 'otter.identify("user-id")', key: "analytics.setup.docIdentify" },
  { code: 'data-otter-event="signup"', key: "analytics.setup.docAttr" },
  { code: "#otter-ignore", key: "analytics.setup.docIgnore" },
] as const;

export function TrackingApiDoc() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <span className="text-[13px] font-medium">{t("analytics.setup.trackingApi")}</span>
      <dl className="flex flex-col gap-1.5">
        {API_DOC.map((entry) => (
          <div
            key={entry.code}
            className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="shrink-0 font-mono text-[12px] sm:w-72">{entry.code}</dt>
            <dd className="text-[12px] text-muted-foreground">{t(entry.key)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Health ────────────────────────────────────────────────────────────────

interface CollectStats {
  accepted: number;
  bots: number;
  rejectedHost: number;
  rejectedPath: number;
  invalid: number;
  rateLimited: number;
}

const HEALTH_KEYS = [
  "accepted",
  "bots",
  "rejectedHost",
  "rejectedPath",
  "invalid",
  "rateLimited",
] as const;

export function HealthSection({ stats }: { stats: CollectStats | null }) {
  const { t } = useTranslation();
  return (
    <SettingsSection
      icon={Activity03Icon}
      title={t("analytics.setup.health")}
      description={t("analytics.setup.healthDesc")}
    >
      <div className="grid gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2">
        {HEALTH_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px]">{t(`analytics.setup.stat.${key}`)}</span>
              <span className="font-mono text-[13px] tabular-nums">
                {stats === null ? "–" : stats[key]}
              </span>
            </div>
            <span className="text-[11.5px] text-muted-foreground">
              {t(`analytics.setup.stat.${key}Desc`)}
            </span>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
