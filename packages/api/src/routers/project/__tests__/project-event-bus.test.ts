/**
 * A live subscription's failures are handled inside the bus.
 *
 * Bun's RedisClient rejects `subscribe` once its reconnection budget is spent
 * (Redis down), and throws SYNCHRONOUSLY from `unsubscribe` before it ever
 * connected. The first used to float as an unhandled rejection (Bun exits the
 * process on one) and the second escaped `close()`. A fake client stands in
 * for both here.
 */
import { describe, expect, it, vi } from "vite-plus/test";

const redis = vi.hoisted(() => {
  const state = {
    subscribe: (_channel: string, _listener: (payload: string) => void): Promise<number> =>
      Promise.resolve(1),
    unsubscribed: 0,
    closed: 0,
  };
  return state;
});

vi.mock("../../../lib/redis", () => ({
  createRedis: () => ({
    subscribe: (channel: string, listener: (payload: string) => void) =>
      redis.subscribe(channel, listener),
    unsubscribe: () => {
      redis.unsubscribed += 1;
      throw new Error("ERR_REDIS_INVALID_STATE: not connected");
    },
    close: () => {
      redis.closed += 1;
    },
  }),
}));

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import {
  EventBusSubscribeError,
  subscribeOrgEvents,
  subscribeProjectEvents,
} from "../project-event-bus";

const projectId = zId(ID_PREFIX.project).parse("prj_eventbustest0000000000000");

describe("live subscriptions when Redis is down", () => {
  it("a rejected subscribe closes the connection and reports a typed failure", async () => {
    redis.subscribe = () => Promise.reject(new Error("Max reconnection attempts reached"));
    redis.closed = 0;
    const failed = Promise.withResolvers<EventBusSubscribeError>();
    subscribeProjectEvents(projectId, () => {}, failed.resolve);
    const error = await failed.promise;
    expect(error).toBeInstanceOf(EventBusSubscribeError);
    expect(error.channel).toBe(`project:${projectId}:events`);
    expect(error.message).toContain("Max reconnection attempts");
    expect(redis.closed).toBe(1);
  });

  it("a subscribe that rejects after close() is the teardown, not a failure", async () => {
    const pending = Promise.withResolvers<number>();
    redis.subscribe = () => pending.promise;
    const onFailure = vi.fn();
    const subscription = subscribeOrgEvents("org_eventbustest", () => {}, onFailure);
    subscription.close();
    pending.reject(new Error("connection closed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("close() on a subscriber that never connected does not throw, and is idempotent", () => {
    redis.subscribe = () => new Promise<number>(() => {});
    redis.unsubscribed = 0;
    redis.closed = 0;
    const subscription = subscribeOrgEvents("org_eventbustest", () => {});
    expect(() => subscription.close()).not.toThrow();
    expect(() => subscription.close()).not.toThrow();
    expect(redis.unsubscribed).toBe(1);
    expect(redis.closed).toBe(1);
  });

  it("a malformed payload or a throwing listener does not reach the subscriber", async () => {
    const delivered = Promise.withResolvers<(payload: string) => void>();
    redis.subscribe = (_channel, listener) => {
      delivered.resolve(listener);
      return new Promise<number>(() => {});
    };
    const onEvent = vi.fn(() => {
      throw new Error("listener bug");
    });
    subscribeProjectEvents(projectId, onEvent);
    const listener = await delivered.promise;
    expect(() => listener("{not json")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(() => listener(JSON.stringify({ kind: "manifest", action: "changed" }))).not.toThrow();
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
