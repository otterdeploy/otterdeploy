/**
 * od-w5rv: `env --service <stack>` used to die with a bare "Service or project
 * not found".
 *
 * A project's resources share one namespace, so the stack name MATCHED and its
 * compose resourceId went to `service.env.*`, which 404s — and the CLI's own
 * friendly not-found never fired, because something had matched. These pin the
 * three failures apart, and pin that the stack case names its children (the
 * whole point: the answer is one suffix away).
 */
import { describe, expect, test, vi } from "vite-plus/test";

const abortSpy = vi.fn((message: string, ...hints: string[]): never => {
  throw new Error([message, ...hints].join(" | "));
});

vi.mock("../lib/ui", () => ({
  abort: (message: string, ...hints: string[]) => abortSpy(message, ...hints),
}));

const { resolveServiceTarget } = await import("./env-target");

const RESOURCES = [
  { resourceId: "res_stack", name: "postiz", type: "compose" },
  { resourceId: "res_app", name: "postiz-service", type: "service", stackId: "res_stack" },
  { resourceId: "res_db", name: "postiz-db", type: "database", stackId: "res_stack" },
  { resourceId: "res_solo", name: "landing", type: "service", stackId: null },
];

describe("resolveServiceTarget", () => {
  test("returns the service when one is named", () => {
    expect(resolveServiceTarget(RESOURCES, "postiz-service", "shared").resourceId).toBe("res_app");
  });

  test("naming the stack lists its services instead of 404ing", () => {
    expect(() => resolveServiceTarget(RESOURCES, "postiz", "shared")).toThrow(
      /compose stack, not a service/,
    );
    const [message, ...hints] = abortSpy.mock.calls.at(-1) ?? [];
    expect(message).toContain("postiz");
    expect(hints.join(" ")).toContain("postiz-service");
    // The database child is not a service and must not be offered as one.
    expect(hints.join(" ")).not.toContain("postiz-db");
  });

  test("a stack with no children says so rather than offering nothing", () => {
    const bare = [{ resourceId: "res_empty", name: "empty", type: "compose" }];
    expect(() => resolveServiceTarget(bare, "empty", "shared")).toThrow(/no services yet/);
  });

  test("naming a database says what it is", () => {
    expect(() => resolveServiceTarget(RESOURCES, "postiz-db", "shared")).toThrow(
      /is a database, not a service/,
    );
  });

  test("naming nothing that exists still suggests the near miss", () => {
    expect(() => resolveServiceTarget(RESOURCES, "landin", "shared")).toThrow(/No service/);
    expect((abortSpy.mock.calls.at(-1) ?? []).join(" ")).toContain("landing");
  });
});
