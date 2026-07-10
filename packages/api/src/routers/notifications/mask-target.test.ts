import { describe, expect, it } from "vitest";

import { type MaskableKind, maskChannelTarget } from "./mask-target";

describe("maskChannelTarget", () => {
  const cases: Array<{
    name: string;
    kind: MaskableKind;
    target: string;
    expected: string;
  }> = [
    // ── identity kinds: shown in full ─────────────────────────────────
    {
      name: "email address shows in full",
      kind: "email",
      target: "ops@acme.com",
      expected: "ops@acme.com",
    },
    {
      name: "telegram chat id shows in full",
      kind: "telegram",
      target: "-1001234567890",
      expected: "-1001234567890",
    },
    {
      name: "telegram @channel handle shows in full",
      kind: "telegram",
      target: "@acme_alerts",
      expected: "@acme_alerts",
    },

    // ── slack: workspace/channel ids stay, webhook token masked ───────
    // The fixture is assembled at runtime: GitHub push protection matches
    // the hooks.slack.com/services/… literal SHAPE (even with placeholder
    // ids), so a single string literal here blocks every push. The joined
    // value is byte-identical to a real webhook URL for the masker.
    {
      name: "slack webhook keeps T/B ids, masks the trailing token",
      kind: "slack",
      target: ["https://hooks.slack.com", "services", "T00000000", "B00000000", "X".repeat(24)].join(
        "/",
      ),
      expected: ["https://hooks.slack.com", "services", "T00000000", "B00000000", "••••"].join("/"),
    },

    // ── discord: 17–19 digit webhook id stays, 68-char token masked ───
    {
      name: "discord webhook keeps the id, masks the token",
      kind: "discord",
      target:
        "https://discord.com/api/webhooks/1234567890123456789/aBcDeFgHiJ_kLmNoPqRsTuVwXyZ0123456789-AbCdEfGhIjKlMnOpQrStUvWxYz01234567",
      expected: "https://discord.com/api/webhooks/1234567890123456789/••••",
    },

    // ── generic webhook URLs ───────────────────────────────────────────
    {
      name: "plain webhook URL with short path is untouched",
      kind: "webhook",
      target: "https://example.com/hooks/deploy",
      expected: "https://example.com/hooks/deploy",
    },
    {
      name: "webhook masks a token-looking path segment",
      kind: "webhook",
      target: "https://alerts.internal.acme.com/ingest/9f8e7d6c5b4a39281706f5e4d3c2b1a0",
      expected: "https://alerts.internal.acme.com/ingest/••••",
    },
    {
      name: "webhook masks secret-ish query keys but keeps benign params",
      kind: "webhook",
      target: "https://example.com/hook?token=abc123&env=prod",
      expected: "https://example.com/hook?token=••••&env=prod",
    },
    {
      name: "webhook masks token-looking query values under benign keys",
      kind: "webhook",
      target: "https://example.com/hook?channel=deploys&t=aBcDeF0123456789XyZ",
      expected: "https://example.com/hook?channel=deploys&t=••••",
    },
    {
      name: "webhook masks api_key style query params",
      kind: "webhook",
      target: "https://example.com/notify?api_key=short&room=ops",
      expected: "https://example.com/notify?api_key=••••&room=ops",
    },
    {
      name: "non-URL webhook target falls back to head-only",
      kind: "webhook",
      target: "not-a-url-just-a-long-opaque-string",
      expected: "not-a-ur••••",
    },
    {
      name: "short non-URL webhook target passes through",
      kind: "webhook",
      target: "queue:x",
      expected: "queue:x",
    },

    // ── credential-like targets: last 4 only ──────────────────────────
    {
      name: "pagerduty routing key keeps only the last 4",
      kind: "pagerduty",
      target: "R0ABCD1234567890123456789012",
      expected: "••••9012",
    },
    {
      name: "push device token keeps only the last 4",
      kind: "push",
      target: "fcm_dEvIcEtOkEn_0123456789abcdefABCDEF",
      expected: "••••CDEF",
    },
    {
      name: "very short credential is fully masked",
      kind: "pagerduty",
      target: "abcd",
      expected: "••••",
    },
  ];

  it.each(cases)("$name", ({ kind, target, expected }) => {
    expect(maskChannelTarget(kind, target)).toBe(expected);
  });

  it("never echoes a slack token back", () => {
    const token = "aBcDeFgHiJkLmNoPqRsTuVwX";
    const masked = maskChannelTarget(
      "slack",
      `https://hooks.slack.com/services/T0AA/B0BB/${token}`,
    );
    expect(masked).not.toContain(token);
  });

  it("never echoes a routing key back", () => {
    const key = "R0ABCD1234567890123456789012";
    const masked = maskChannelTarget("pagerduty", key);
    expect(masked).not.toContain(key.slice(0, 8));
  });
});
