import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { Field, SectionHeader, SettingRow } from "../form-primitives";
import { useFormContext } from "../form-context";

interface StepNetworkingProps {
  kind: ServiceKind | null;
}

export function StepNetworking({ kind }: StepNetworkingProps) {
  const form = useFormContext();
  const isWorker = kind?.id === "worker";
  const isCron = kind?.id === "cron";
  const isStatic = kind?.id === "static";

  if (isCron) {
    return (
      <>
        <SectionHeader title="Schedule" sub="When should this job run?" />
        <Card className="mt-3 rounded-md">
          <CardContent className="flex flex-col gap-2.5">
            <Field label="Cron expression">
              <Input className="font-mono" defaultValue="0 3 * * *" />
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Every day at 03:00 UTC · next run in 7h 12m
              </div>
            </Field>
            <Field label="Timezone">
              <Select defaultValue="UTC" items={[
                { label: "UTC", value: "UTC" },
                { label: "America/Los_Angeles", value: "America/Los_Angeles" },
                { label: "Europe/London", value: "Europe/London" },
              ]}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Command">
              <Input className="font-mono" defaultValue="node scripts/cleanup.js" />
            </Field>
            <Field label="Max runtime">
              <Input className="font-mono" defaultValue="30m" />
            </Field>
          </CardContent>
        </Card>
        <Card className="mt-3.5 rounded-md">
          <CardContent>
            <SettingRow
              label="Skip if previous run still active"
              sub="Don't pile up overlapping invocations"
              defaultOn
            />
            <SettingRow label="Alert on failure" defaultOn sub="Send to #ops Slack channel" />
          </CardContent>
        </Card>
      </>
    );
  }

  if (isWorker) {
    return (
      <>
        <SectionHeader
          title="Workers don't expose ports"
          sub="No HTTP listener — this service runs a long process"
        />
        <Card className="mt-3 rounded-md">
          <CardContent className="flex flex-col gap-2.5">
            <Field label="Process command">
              <Input className="font-mono" defaultValue="celery -A app worker --loglevel=info" />
            </Field>
            <Field label="Graceful shutdown timeout">
              <Input className="font-mono" defaultValue="30s" />
            </Field>
            <Field label="Liveness probe">
              <Input
                className="font-mono"
                placeholder="optional · exec command, e.g. celery inspect ping"
              />
            </Field>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="Ports" sub="Which container ports should be exposed?" />
      <form.AppField name="ports">
        {(f) => <f.PortsField />}
      </form.AppField>

      {!isStatic && (
        <>
          <div className="mt-4.5">
            <SectionHeader
              title="Health check"
              sub="How does Otterstack know your service is ready to serve traffic?"
            />
          </div>
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-2.5">
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-2.5">
                <form.AppField name="healthPath">
                  {(f) => <f.TextField label="Path" className="font-mono" />}
                </form.AppField>
                <form.AppField name="healthInterval">
                  {(f) => <f.NumberField label="Interval (s)" min={1} className="font-mono" />}
                </form.AppField>
                <Field label="Timeout">
                  <Input className="font-mono" defaultValue="3s" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Successes before ready">
                  <Input className="font-mono" type="number" defaultValue={2} />
                </Field>
                <Field label="Failures before unhealthy">
                  <Input className="font-mono" type="number" defaultValue={3} />
                </Field>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="mt-4.5">
        <SectionHeader title="Edge proxy" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <SettingRow
            label="Auto-issue TLS certificates"
            sub="Let's Encrypt · auto-renewed before expiry"
            defaultOn
          />
          <SettingRow label="HTTP → HTTPS redirect" defaultOn sub="Force secure connections" />
          <SettingRow label="HTTP/3 (QUIC)" defaultOn sub="Serve over QUIC where available" />
          <SettingRow
            label="Compression (zstd, gzip)"
            defaultOn
            sub="Encode responses on the wire"
          />
          <SettingRow label="WebSocket upgrade" defaultOn sub="Allow ws:// connection upgrades" />
          <SettingRow
            label="Forward X-Forwarded-For"
            defaultOn
            sub="Pass real client IP through to upstream"
          />
        </CardContent>
      </Card>
    </>
  );
}
