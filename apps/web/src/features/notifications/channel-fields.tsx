/**
 * Per-kind field set + placeholder copy for the add-channel dialog. Split out
 * of the dialog so each file stays within the lint line budget.
 */

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

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
    transport: "SMTP via Postmark",
  },
  webhook: {
    name: "internal-oncall",
    target: "https://hooks.example.com/oncall",
    transport: "POST · HMAC-SHA256",
  },
  telegram: {
    name: "Telegram",
    target: "chat_id: 123456789",
    transport: "bot · long-poll",
  },
  pagerduty: {
    name: "PagerDuty service",
    target: "Routing key (R0...)",
    transport: "Events API v2",
  },
};

/** The input set below the type picker — adapts to the selected channel kind. */
export function ChannelFields({
  kind,
  target,
  setTarget,
}: {
  kind: ChannelKind;
  target: string;
  setTarget: (v: string) => void;
}) {
  return (
    <>
      {(kind === "slack" || kind === "discord" || kind === "webhook") && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel-target">
            {kind === "webhook" ? "POST endpoint" : "Webhook URL"}
          </Label>
          <Input
            id="channel-target"
            className="font-mono"
            placeholder={PLACEHOLDERS[kind].target}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
      )}

      {kind === "email" && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-target">Recipient address</Label>
            <Input
              id="channel-target"
              className="font-mono"
              placeholder={PLACEHOLDERS.email.target}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input
                id="smtp-host"
                className="font-mono"
                defaultValue="smtp.postmarkapp.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="smtp-from">From address</Label>
              <Input
                id="smtp-from"
                className="font-mono"
                defaultValue="alerts@otterdeploy.dev"
              />
            </div>
          </div>
        </>
      )}

      {kind === "telegram" && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bot-token">Bot token</Label>
            <Input
              id="bot-token"
              className="font-mono"
              placeholder="123456:ABC-DEF…"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="chat-id">Chat ID</Label>
            <Input
              id="chat-id"
              className="font-mono"
              placeholder="-1001234567890"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </>
      )}

      {kind === "pagerduty" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="routing-key">Integration routing key</Label>
          <Input
            id="routing-key"
            className="font-mono"
            placeholder={PLACEHOLDERS.pagerduty.target}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
      )}

      {kind === "webhook" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="hmac-secret">HMAC secret (optional)</Label>
          <Input
            id="hmac-secret"
            className="font-mono"
            placeholder="••••••••••••"
          />
        </div>
      )}
    </>
  );
}
