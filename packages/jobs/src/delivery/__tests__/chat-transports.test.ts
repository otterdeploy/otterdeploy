/**
 * What the chat transports actually put on the wire.
 *
 * The Discord case is a regression test with a real incident behind it: the
 * payload is Components V2 (no `content`, no `embeds`), and Discord's Execute
 * Webhook endpoint ignores `components` unless `with_components=true` is on the
 * query string. Without it every send is a `400 50006 Cannot send an empty
 * message` — one install's #alerts channel failed 100% of deliveries for as
 * long as it existed, so nothing that fired ever reached a human.
 *
 * `post` is mocked (same `bun test` + `mock.module` pattern as
 * webhook.test.ts) because the assertion is about the URL and body we hand it,
 * not about reaching Discord.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";

import type { ChannelEvent, ResolvedChannel } from "../types";

let deliverDiscord: typeof import("../chat-transports").deliverDiscord;
const posted: Array<{ url: string; body: string }> = [];

beforeAll(async () => {
  await mock.module("../post", () => ({
    post: (url: string, init: { body?: string }) => {
      posted.push({ url, body: init.body ?? "" });
      return Promise.resolve({ ok: true });
    },
  }));
  ({ deliverDiscord } = await import("../chat-transports"));
});

const channel = (target: string): ResolvedChannel => ({
  id: "ntfc_test",
  kind: "discord",
  name: "#alerts",
  target,
  config: {},
  secret: null,
});

const event: ChannelEvent = {
  eventId: "deploy.crashed",
  severity: "err",
  title: "Service crashed",
  message: "postiz / postiz-db: container exited (code 1)",
  data: { resource: "postiz-db", project: "shared" },
};

describe("deliverDiscord", () => {
  test("asks the webhook to respect components, or the message reads as empty", async () => {
    posted.length = 0;
    await deliverDiscord(channel("https://discord.com/api/webhooks/1/abc"), event);
    expect(posted[0]?.url).toBe("https://discord.com/api/webhooks/1/abc?with_components=true");
  });

  test("keeps a target's own query, so a thread-bound webhook stays in its thread", async () => {
    posted.length = 0;
    await deliverDiscord(channel("https://discord.com/api/webhooks/1/abc?thread_id=42"), event);
    expect(posted[0]?.url).toBe(
      "https://discord.com/api/webhooks/1/abc?thread_id=42&with_components=true",
    );
  });

  test("does not append twice when the operator already pasted the flag", async () => {
    posted.length = 0;
    const target = "https://discord.com/api/webhooks/1/abc?with_components=true";
    await deliverDiscord(channel(target), event);
    expect(posted[0]?.url).toBe(target);
  });

  test("sends components only: content/embeds alongside the V2 flag are a 400", async () => {
    posted.length = 0;
    await deliverDiscord(channel("https://discord.com/api/webhooks/1/abc"), event);
    const body: unknown = JSON.parse(posted[0]?.body ?? "{}");
    expect(body).toMatchObject({ flags: 1 << 15 });
    expect(body).not.toHaveProperty("content");
    expect(body).not.toHaveProperty("embeds");
  });
});
