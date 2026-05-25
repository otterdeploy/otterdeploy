// Step_Networking — port exposure, health checks, edge proxy settings.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1605-1913.
import type { AnyFieldApi } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import { Field, SectionHeader, SettingRow } from "../form-primitives";
import { I } from "../icons";

export interface Port {
  port: number;
  protocol: string;
  public: boolean;
  host: string;
}

interface NetworkingProps {
  portsField: AnyFieldApi;
  healthPathField: AnyFieldApi;
  healthIntervalField: AnyFieldApi;
  kind: ServiceKind | null;
}

const PROTOCOLS = [
  { value: "http", label: "HTTP" },
  { value: "http2", label: "HTTP/2" },
  { value: "grpc", label: "gRPC" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const PORTS_GRID = "grid grid-cols-[80px_100px_1fr_70px_50px] items-center gap-2";

export function StepNetworking({
  portsField,
  healthPathField,
  healthIntervalField,
  kind,
}: NetworkingProps) {
  const ports = portsField.state.value as Port[];
  const healthPath = healthPathField.state.value as string;
  const healthInterval = healthIntervalField.state.value as string;

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
      <Card className="mt-3 gap-0 overflow-hidden rounded-md p-0">
        <div
          className={cn(
            PORTS_GRID,
            "border-b bg-muted/50 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          )}
        >
          <span>Port</span>
          <span>Protocol</span>
          <span>Public hostname</span>
          <span>Public</span>
          <span />
        </div>
        {ports.map((p, i) => (
          <div
            key={i}
            className={cn(
              PORTS_GRID,
              "px-3.5 py-2",
              i === ports.length - 1 ? "" : "border-b border-border/60",
            )}
          >
            <Input
              className="font-mono"
              type="number"
              value={p.port}
              onChange={(e) => {
                const next = ports.map((x, j) =>
                  j === i ? { ...x, port: +e.target.value } : x,
                );
                portsField.handleChange(next);
              }}
            />
            <Select
              value={p.protocol}
              onValueChange={(v) => {
                if (typeof v !== "string") return;
                const next = ports.map((x, j) => (j === i ? { ...x, protocol: v } : x));
                portsField.handleChange(next);
              }}
              items={PROTOCOLS}
            >
              <SelectTrigger className="w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map((proto) => (
                  <SelectItem key={proto.value} value={proto.value}>
                    {proto.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className={cn("font-mono", !p.public && "opacity-50")}
              value={p.host}
              onChange={(e) => {
                const next = ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x));
                portsField.handleChange(next);
              }}
              disabled={!p.public}
            />
            <Switch
              checked={p.public}
              onCheckedChange={(v) => {
                const next = ports.map((x, j) => (j === i ? { ...x, public: v } : x));
                portsField.handleChange(next);
              }}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => portsField.handleChange(ports.filter((_, j) => j !== i))}
                aria-label="Remove port"
              >
                <I.x width={11} height={11} />
              </Button>
            </div>
          </div>
        ))}
        <div className="px-3.5 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              portsField.handleChange([
                ...ports,
                { port: 8080, protocol: "http", public: false, host: "" },
              ]);
            }}
          >
            <I.plus width={11} height={11} />
            Add port
          </Button>
        </div>
      </Card>

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
                <Field label="Path">
                  <Input
                    className="font-mono"
                    value={healthPath}
                    onChange={(e) => healthPathField.handleChange(e.target.value)}
                  />
                </Field>
                <Field label="Interval">
                  <Input
                    className="font-mono"
                    value={healthInterval}
                    onChange={(e) => healthIntervalField.handleChange(e.target.value)}
                  />
                </Field>
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
