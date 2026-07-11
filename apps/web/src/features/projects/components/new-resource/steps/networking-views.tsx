/**
 * Per-kind views for the Networking step (static build, and the default
 * ports + health + edge summary). Split out of networking.tsx so that file
 * + its dispatcher stay under the line caps.
 *
 * Honesty notes:
 *   - The old CronSchedule / WorkerNetworking views were removed: cron is
 *     `comingSoon`-gated (no scheduler exists) and portless worker kinds
 *     drop the Networking step entirely, so both were unreachable
 *     decoration whose inputs went nowhere.
 *   - The health-check fields are REAL: they map to the same portable
 *     wget||curl `CMD-SHELL` probe the service settings card writes
 *     (healthcheck-http.ts) and land in the manifest's `healthcheck`,
 *     which the swarm driver enforces. The old "successes before ready"
 *     input was removed — Docker has no such concept.
 *   - The edge-proxy section is a plain summary of platform defaults.
 *     They are not per-service toggles anywhere in the reconciler, so
 *     rendering switches for them would be fake controls.
 */

import { Card, CardContent } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { frameworkLabel } from "../frameworks";
import { useRepoDetection } from "../use-repo-detection";

export function StaticBuild() {
  const form = useFormContext();
  const { framework } = useRepoDetection();
  const label = frameworkLabel(framework);
  return (
    <>
      <SectionHeader
        title="Static build"
        sub="Railpack builds this into a Caddy image and serves it over our Caddy edge — no port, no Dockerfile. Platform defaults (TLS, HTTP → HTTPS, HTTP/3, compression) apply automatically. Requires a project container registry for the build."
      />
      <Card className="mt-3 rounded-md">
        <CardContent>
          <form.AppField name="spa">
            {(f) => (
              <f.SwitchField
                label="Single-page app (SPA) routing"
                description={
                  label
                    ? `Detected ${label} — set automatically. Fall back to index.html for unmatched routes.`
                    : "Fall back to index.html for unmatched routes · Vite / React / Vue / Angular"
                }
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}

// What the Caddy edge applies to every public route. Stated, not toggled:
// none of these are per-service settings in the reconciler today.
const EDGE_DEFAULTS: Array<{ label: string; sub: string }> = [
  { label: "TLS certificates", sub: "Let's Encrypt · issued and renewed automatically" },
  { label: "HTTP → HTTPS", sub: "Plain-HTTP requests are redirected" },
  { label: "HTTP/3 + compression", sub: "QUIC and zstd/gzip encoding where clients support them" },
  { label: "WebSockets + real IP", sub: "ws:// upgrades pass through; X-Forwarded-For is set" },
];

export function PortsAndHealth() {
  const form = useFormContext();
  const { framework, defaultPort } = useRepoDetection();
  const label = frameworkLabel(framework);

  return (
    <>
      <SectionHeader
        title="Ports"
        sub={
          label && defaultPort != null
            ? `Detected ${label} — port ${defaultPort} prefilled; most apps don't need to change it.`
            : "Which container ports should be exposed?"
        }
      />
      <form.AppField name="ports">{(f) => <f.PortsField />}</form.AppField>

      <div className="mt-4.5">
        <SectionHeader
          title="Health check"
          sub="Optional HTTP probe against the primary port, run inside the container as a wget/curl one-liner — images with neither (nor sh) will fail the check. Leave the path empty to rely on process liveness."
        />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-2.5">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2.5">
            <form.AppField name="healthPath">
              {(f) => (
                <f.TextField
                  label="Path (empty = off)"
                  className="font-mono"
                  placeholder="/healthz"
                />
              )}
            </form.AppField>
            <form.AppField name="healthInterval">
              {(f) => <f.NumberField label="Interval (s)" min={1} className="font-mono" />}
            </form.AppField>
            <form.AppField name="healthTimeout">
              {(f) => <f.NumberField label="Timeout (s)" min={1} className="font-mono" />}
            </form.AppField>
            <form.AppField name="healthRetries">
              {(f) => <f.NumberField label="Retries" min={1} className="font-mono" />}
            </form.AppField>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4.5">
        <SectionHeader
          title="Edge proxy"
          sub="Applied by the platform to every public route — not configurable per service yet."
        />
      </div>
      <Card className="mt-2.5 gap-0 rounded-md p-4">
        {EDGE_DEFAULTS.map((d, i) => (
          <div
            key={d.label}
            className={`flex items-start gap-3 py-2 text-xs ${
              i === EDGE_DEFAULTS.length - 1 ? "" : "border-b border-border/60"
            }`}
          >
            <span className="w-36 shrink-0 pt-px text-[11px] text-muted-foreground">{d.label}</span>
            <span className="flex-1 leading-relaxed text-foreground/90">{d.sub}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
