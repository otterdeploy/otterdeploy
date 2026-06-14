/**
 * Per-kind field set for the add/edit-channel dialog. Captures the destination
 * (`target`), an optional `secret` (Telegram bot token, webhook HMAC key, SMTP
 * password), and `config` (email client choice + SMTP server params). Split out
 * of the dialog so each file stays within the lint line budget.
 */
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

import { type ChannelKind } from "./shared";

export const PLACEHOLDERS: Record<
  ChannelKind,
  { name: string; target: string; transport: string }
> = {
  slack: {
    name: "#otterdeploy-deploys",
    target: "https://hooks.slack.com/services/...",
    transport: "incoming-webhook",
  },
  discord: {
    name: "#alerts",
    target: "https://discord.com/api/webhooks/...",
    transport: "webhook",
  },
  email: {
    name: "oncall@team.dev",
    target: "oncall@team.dev",
    transport: "SMTP via Resend",
  },
  webhook: {
    name: "internal-oncall",
    target: "https://hooks.example.com/oncall",
    transport: "POST · HMAC-SHA256",
  },
  telegram: {
    name: "Telegram",
    target: "-1001234567890",
    transport: "bot · long-poll",
  },
  pagerduty: {
    name: "PagerDuty service",
    target: "Routing key (R0...)",
    transport: "Events API v2",
  },
  push: {
    name: "On-call phone",
    target: "FCM registration token or /topics/<name>",
    transport: "FCM",
  },
};

const TARGET_LABEL: Record<ChannelKind, string> = {
  slack: "Webhook URL",
  discord: "Webhook URL",
  email: "Recipient address",
  webhook: "POST endpoint",
  telegram: "Chat ID",
  pagerduty: "Integration routing key",
  push: "Device token / topic",
};

interface ChannelFieldsProps {
  kind: ChannelKind;
  target: string;
  setTarget: (v: string) => void;
  secret: string;
  setSecret: (v: string) => void;
  config: Record<string, string>;
  setConfigField: (key: string, value: string) => void;
  errors: Record<string, string>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[11px] text-destructive">{message}</p>;
}

/** The input set below the type picker — adapts to the selected channel kind. */
export function ChannelFields({
  kind,
  target,
  setTarget,
  secret,
  setSecret,
  config,
  setConfigField,
  errors,
}: ChannelFieldsProps) {
  const emailClient = config.client === "smtp" ? "smtp" : "resend";
  // email always carries a secret: SMTP password, or the Resend API key.
  const needsSecret =
    kind === "telegram" || kind === "webhook" || kind === "email";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-target">{TARGET_LABEL[kind]}</Label>
        <Input
          id="channel-target"
          aria-invalid={Boolean(errors.target)}
          className="font-mono"
          placeholder={PLACEHOLDERS[kind].target}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <FieldError message={errors.target} />
      </div>

      {kind === "email" && (
        <div className="flex flex-col gap-2">
          <Label className="text-[11px] text-muted-foreground">Deliver via</Label>
          <div className="flex gap-2">
            {(["resend", "smtp"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConfigField("client", c)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12px] capitalize transition-colors",
                  emailClient === c
                    ? "border-foreground bg-muted"
                    : "border-border hover:bg-muted/50",
                )}
              >
                {c === "smtp" ? "SMTP" : "Resend"}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === "email" && emailClient === "smtp" && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input
                id="smtp-host"
                aria-invalid={Boolean(errors.host)}
                className="font-mono"
                placeholder="smtp.example.com"
                value={config.host ?? ""}
                onChange={(e) => setConfigField("host", e.target.value)}
              />
              <FieldError message={errors.host} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                aria-invalid={Boolean(errors.port)}
                className="font-mono"
                placeholder="587"
                value={config.port ?? ""}
                onChange={(e) => setConfigField("port", e.target.value)}
              />
              <FieldError message={errors.port} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-from">From address</Label>
              <Input
                id="smtp-from"
                className="font-mono"
                placeholder="alerts@example.com"
                value={config.from ?? ""}
                onChange={(e) => setConfigField("from", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                className="font-mono"
                placeholder="apikey / user"
                value={config.username ?? ""}
                onChange={(e) => setConfigField("username", e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {kind === "email" && emailClient === "resend" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="resend-from">From address (optional)</Label>
          <Input
            id="resend-from"
            className="font-mono"
            placeholder="alerts@yourdomain.com"
            value={config.from ?? ""}
            onChange={(e) => setConfigField("from", e.target.value)}
          />
        </div>
      )}

      {needsSecret && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel-secret">{secretLabel(kind, emailClient)}</Label>
          <Input
            id="channel-secret"
            type="password"
            aria-invalid={Boolean(errors.secret)}
            className="font-mono"
            placeholder={secretPlaceholder(kind, emailClient)}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <FieldError message={errors.secret} />
        </div>
      )}
    </>
  );
}

function secretLabel(kind: ChannelKind, emailClient: "resend" | "smtp"): string {
  if (kind === "telegram") return "Bot token";
  if (kind === "email")
    return emailClient === "smtp"
      ? "SMTP password"
      : "Resend API key (optional)";
  return "HMAC secret (optional)";
}

function secretPlaceholder(
  kind: ChannelKind,
  emailClient: "resend" | "smtp",
): string {
  if (kind === "telegram") return "123456:ABC-DEF…";
  if (kind === "email" && emailClient === "resend")
    return "re_… (blank = server default)";
  return "••••••••••••";
}
