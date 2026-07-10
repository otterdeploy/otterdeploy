import { describe, expect, it } from "vitest";

import {
  channelTargetHint,
  eventLabel,
  eventSeverityOf,
  inboxDetailRows,
  inboxEventId,
} from "./shared";

describe("channelTargetHint", () => {
  const cases: Array<{
    name: string;
    kind: Parameters<typeof channelTargetHint>[0];
    target: string;
    expected: string;
  }> = [
    {
      name: "email shows as-is",
      kind: "email",
      target: "ops@acme.com",
      expected: "ops@acme.com",
    },
    {
      name: "telegram chat id shows as-is",
      kind: "telegram",
      target: "-1001234567890",
      expected: "-1001234567890",
    },
    {
      name: "slack webhook reduces to the host",
      kind: "slack",
      target: "https://hooks.slack.com/services/T01ABCDE2F/B01ABCDE2F/••••",
      expected: "hooks.slack.com",
    },
    {
      name: "discord webhook reduces to the host",
      kind: "discord",
      target: "https://discord.com/api/webhooks/1234567890123456789/••••",
      expected: "discord.com",
    },
    {
      name: "generic webhook reduces to the host",
      kind: "webhook",
      target: "https://alerts.internal.acme.com/ingest/••••",
      expected: "alerts.internal.acme.com",
    },
    {
      name: "long non-URL value is truncated with an ellipsis",
      kind: "email",
      target: "very-long-address-for-oncall-rotation@subdomain.acme.com",
      expected: "very-long-address-for-onc…",
    },
    {
      name: "masked pagerduty routing key passes through",
      kind: "pagerduty",
      target: "••••9012",
      expected: "••••9012",
    },
    {
      name: "webhook with a non-URL target falls back to truncation",
      kind: "webhook",
      target: "not-a-ur••••",
      expected: "not-a-ur••••",
    },
  ];

  it.each(cases)("$name", ({ kind, target, expected }) => {
    expect(channelTargetHint(kind, target)).toBe(expected);
  });
});

describe("eventLabel", () => {
  it("maps catalog ids to their label", () => {
    expect(eventLabel("deploy.failed")).toBe("Deploy failed");
  });
  it("labels the synthetic test event", () => {
    expect(eventLabel("test.ping")).toBe("Test ping");
  });
  it("falls back to the raw id for unknown events", () => {
    expect(eventLabel("future.event")).toBe("future.event");
  });
});

describe("eventSeverityOf", () => {
  it("maps catalog ids to their severity", () => {
    expect(eventSeverityOf("deploy.failed")).toBe("err");
  });
  it("defaults unknown/test events to info", () => {
    expect(eventSeverityOf("test.ping")).toBe("info");
    expect(eventSeverityOf("future.event")).toBe("info");
  });
});

describe("inboxEventId", () => {
  it("reads a string eventId from the payload", () => {
    expect(inboxEventId({ eventId: "deploy.failed", resource: "api" })).toBe("deploy.failed");
  });
  it("returns null for null / missing / non-string / empty eventId", () => {
    expect(inboxEventId(null)).toBeNull();
    expect(inboxEventId(undefined)).toBeNull();
    expect(inboxEventId({ resource: "api" })).toBeNull();
    expect(inboxEventId({ eventId: 42 })).toBeNull();
    expect(inboxEventId({ eventId: "" })).toBeNull();
  });
});

describe("inboxDetailRows", () => {
  it("drops internal plumbing keys and humanizes the rest", () => {
    const rows = inboxDetailRows({
      eventId: "deploy.failed",
      occurrence: "job-123",
      deploymentId: "dep_abc",
      resource: "api",
    });
    expect(rows).toEqual([
      { key: "deploymentId", label: "Deployment Id", value: "dep_abc" },
      { key: "resource", label: "Resource", value: "api" },
    ]);
  });
  it("skips empty / nullish values and stringifies primitives", () => {
    const rows = inboxDetailRows({ retries: 3, ok: false, blank: "", missing: null });
    expect(rows).toEqual([
      { key: "retries", label: "Retries", value: "3" },
      { key: "ok", label: "Ok", value: "false" },
    ]);
  });
  it("JSON-stringifies non-primitive values", () => {
    expect(inboxDetailRows({ meta: { a: 1 } })).toEqual([
      { key: "meta", label: "Meta", value: '{"a":1}' },
    ]);
  });
  it("returns an empty array for null / undefined data", () => {
    expect(inboxDetailRows(null)).toEqual([]);
    expect(inboxDetailRows(undefined)).toEqual([]);
  });
});
