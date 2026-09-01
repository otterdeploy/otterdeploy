import { describe, expect, it } from "vite-plus/test";

import { bellLabel } from "./bell-badge";
import { bellState, groupSettled, itemSeverity, subjectOfItem, worstSeverity } from "./inbox-fold";
import { hiddenUnreadCount, inboxViewState } from "./inbox-view-state";
import {
  EVENTS,
  SUBSCRIBABLE_EVENTS,
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

describe("worstSeverity", () => {
  const item = (eventId: string) => ({ data: { eventId } });

  it("returns null for an empty list, so the badge stays off", () => {
    expect(worstSeverity([])).toBeNull();
  });

  it("picks the most concerning, not the first or the newest", () => {
    // The ordering matters: a failure listed last must still win, or a burst of
    // routine chatter would bury the one row worth acting on.
    expect(worstSeverity([item("deploy.started"), item("build.failed")])).toBe("err");
    expect(worstSeverity([item("build.failed"), item("deploy.started")])).toBe("err");
    expect(worstSeverity([item("deploy.succeeded"), item("health.degraded")])).toBe("warn");
  });

  it("ranks err > warn > info > ok", () => {
    expect(worstSeverity([item("cert.expiring"), item("cert.renewed")])).toBe("warn");
    expect(worstSeverity([item("deploy.started"), item("deploy.succeeded")])).toBe("info");
    expect(worstSeverity([item("deploy.succeeded")])).toBe("ok");
  });

  it("treats a payload with no usable eventId as info rather than dropping it", () => {
    // Dropping it would silently hide a notification the user can see listed.
    expect(worstSeverity([{ data: null }])).toBe("info");
    expect(worstSeverity([{ data: { eventId: "" } }])).toBe("info");
    expect(worstSeverity([{ data: { nope: 1 } }])).toBe("info");
  });

  it("maps an unknown future event id to info, matching eventSeverityOf", () => {
    expect(worstSeverity([item("future.event")])).toBe("info");
  });
});

describe("bellLabel", () => {
  it("announces the bare unread state on its own", () => {
    expect(bellLabel({ unread: "Notifications", failure: null })).toBe("Notifications");
  });

  it("appends the failure hint only when one applies", () => {
    expect(bellLabel({ unread: "Notifications: 2 unread", failure: null })).toBe(
      "Notifications: 2 unread",
    );
    expect(bellLabel({ unread: "Notifications: 1 unread", failure: "has a failure" })).toBe(
      "Notifications: 1 unread, has a failure",
    );
  });

  it("says nothing about builds: those belong to the activity indicator", () => {
    // The bell answers "anything unread?" and only that. In-flight work is the
    // activity indicator's job, and duplicating it here is what made the old
    // pulsing ring both redundant and (being project-scoped) frequently wrong.
    expect(bellLabel({ unread: "Notifications: 3 unread", failure: "failure" })).toBe(
      "Notifications: 3 unread, failure",
    );
  });
});

describe("inboxViewState", () => {
  // The regression this exists for. A failed request leaves the item list
  // empty, so an `items.length === 0` check that runs before the error check
  // renders "No notifications yet" — the app stating that nothing happened
  // when in fact it could not find out. Indistinguishable, to the operator,
  // from a genuinely quiet inbox.
  it("reports error, not empty, when the request failed", () => {
    expect(inboxViewState({ isLoading: false, isError: true, itemCount: 0 })).toBe("error");
  });

  it("still reports error when a stale list is being shown", () => {
    // react-query keeps the previous page on a background refetch failure, so
    // a non-zero count must not mask the failure either.
    expect(inboxViewState({ isLoading: false, isError: true, itemCount: 5 })).toBe("error");
  });

  it("prefers the skeleton over both while the first request is in flight", () => {
    expect(inboxViewState({ isLoading: true, isError: false, itemCount: 0 })).toBe("loading");
    expect(inboxViewState({ isLoading: true, isError: true, itemCount: 0 })).toBe("loading");
  });

  it("reports empty only for a request that actually succeeded with nothing", () => {
    expect(inboxViewState({ isLoading: false, isError: false, itemCount: 0 })).toBe("empty");
  });

  it("reports the list when there is something to show", () => {
    expect(inboxViewState({ isLoading: false, isError: false, itemCount: 1 })).toBe("list");
  });
});

describe("hiddenUnreadCount", () => {
  // "Mark all read" clears every unread row server-side, not just the rendered
  // ones, so unrendered unread rows have to be announced or the button
  // silently discards notifications the operator never saw.
  it("reports unread rows the page could not carry", () => {
    expect(hiddenUnreadCount({ unread: 45, itemCount: 20 })).toBe(25);
  });

  it("is zero when everything unread is on screen", () => {
    expect(hiddenUnreadCount({ unread: 3, itemCount: 20 })).toBe(0);
  });

  // Read rows count toward `items` but not toward `unread`, so the difference
  // goes negative in the ordinary case and must not render as "-17 older".
  it("never goes negative when the page is mostly read rows", () => {
    expect(hiddenUnreadCount({ unread: 3, itemCount: 20 })).toBe(0);
    expect(hiddenUnreadCount({ unread: 0, itemCount: 50 })).toBe(0);
  });
});

describe("the subscribable catalog", () => {
  // A row you can subscribe to that nothing can ever emit is a promise the
  // product cannot keep. `cert.expiring` is the one: Caddy logs obtain/renew/
  // fail, never expiry (see packages/api/src/edge-logs/cert-promote.ts).
  it("does not offer an event nothing emits", () => {
    expect(SUBSCRIBABLE_EVENTS.map((e) => e.id)).not.toContain("cert.expiring");
  });

  // But the id stays in the catalog: it feeds a z.enum in two contracts, and
  // subscription rows referencing it may already exist in the database.
  it("keeps the id resolvable so stored rows still render", () => {
    expect(EVENTS.map((e) => e.id)).toContain("cert.expiring");
    expect(eventSeverityOf("cert.expiring")).toBe("warn");
  });
});

describe("itemSeverity", () => {
  it("grades host.pressure from the payload, not the catalog", () => {
    expect(itemSeverity({ eventId: "host.pressure", severity: "critical" })).toBe("err");
    expect(itemSeverity({ eventId: "host.pressure", severity: "warning" })).toBe("warn");
    expect(itemSeverity({ eventId: "host.pressure", severity: "info" })).toBe("info");
    // Ungraded pressure keeps the catalog's warn.
    expect(itemSeverity({ eventId: "host.pressure" })).toBe("warn");
  });

  it("uses the catalog for everything else", () => {
    expect(itemSeverity({ eventId: "deploy.failed", severity: "info" })).toBe("err");
    expect(itemSeverity(null)).toBe("info");
  });
});

describe("subjectOfItem", () => {
  it("prefers the encoded subject", () => {
    const data = {
      subjectKind: "service",
      subjectId: "res_1",
      subjectLabel: "api",
      subjectProject: "acme",
      resource: "api",
    };
    expect(subjectOfItem(data)).toEqual({
      kind: "service",
      id: "res_1",
      label: "api",
      project: "acme",
    });
  });

  it("derives a legacy subject from display strings, marked so it never links", () => {
    expect(subjectOfItem({ eventId: "deploy.failed", resource: "api" })).toEqual({
      kind: "service",
      id: "legacy:api",
      label: "api",
    });
    expect(subjectOfItem({ eventId: "host.pressure", recommendation: "disk-pressure" })?.kind).toBe(
      "server",
    );
    expect(subjectOfItem({ eventId: "ssh.rotated" })).toBeNull();
  });
});

describe("groupSettled", () => {
  const at = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 1, 12, 0) - minutesAgo * 60_000);
  const row = (
    id: string,
    title: string,
    data: Record<string, string>,
    minutesAgo: number,
    read = false,
  ) => ({ id, title, data, readAt: read ? at(minutesAgo) : null, createdAt: at(minutesAgo) });
  const host = { subjectKind: "server", subjectId: "h1", subjectLabel: "h1" };
  const api = {
    subjectKind: "service",
    subjectId: "res_api",
    subjectLabel: "api",
    subjectProject: "p",
  };

  it("groups under the subject and folds identical consecutive rows into one line", () => {
    const groups = groupSettled([
      row("a", "Disk 87% full", { eventId: "host.pressure", ...host }, 1),
      row("b", "Disk 87% full", { eventId: "host.pressure", ...host }, 5),
      row("c", "Auto-reclaimed 2 GB", { eventId: "host.pressure", ...host }, 9),
      row("d", "Disk 87% full", { eventId: "host.pressure", ...host }, 12),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((r) => [r.item.title, r.count])).toEqual([
      ["Disk 87% full", 2],
      ["Auto-reclaimed 2 GB", 1],
      ["Disk 87% full", 1],
    ]);
    expect(groups[0]?.rows[0]?.ids).toEqual(["a", "b"]);
    expect(groups[0]?.unread).toBe(4);
  });

  it("puts unread groups first, worst severity first, then read groups by recency", () => {
    const groups = groupSettled([
      row("1", "Deploy succeeded", { eventId: "deploy.succeeded", ...api }, 1, true),
      row("2", "Disk 87% full", { eventId: "host.pressure", severity: "warning", ...host }, 2),
      row("3", "SSH key rotated", { eventId: "ssh.rotated" }, 3),
      row(
        "4",
        "Backup failed",
        { eventId: "backup.failed", subjectKind: "backup", subjectId: "b", subjectLabel: "pg" },
        30,
      ),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["backup:b", "server:h1", "other", "service:res_api"]);
    expect(groups[0]?.severity).toBe("err");
    expect(groups[3]?.severity).toBeNull();
  });
});

describe("bellState", () => {
  it("counts open problems in the worst colour", () => {
    expect(bellState({ open: [{ severity: "warn" }, { severity: "err" }], unread: 40 })).toEqual({
      count: 2,
      severity: "err",
    });
  });

  it("falls back to the unread count, quietly, when nothing is open", () => {
    expect(bellState({ open: [], unread: 3 })).toEqual({ count: 3, severity: "info" });
  });

  it("is off when there is nothing open and nothing unread", () => {
    expect(bellState({ open: [], unread: 0 })).toBeNull();
  });
});
