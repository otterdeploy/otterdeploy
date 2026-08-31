/**
 * od-3hsu.2: `service.env.effective` answers "what will the container see",
 * without ever answering it for a secret.
 *
 * The masking is the point of the test. `resolveServiceEnv` DECRYPTS sealed
 * rows and fetches vault values — it has to, the deploy path consumes the real
 * thing — so a read endpoint built on it leaks cleartext by default. These pin
 * that a secret or sealed row reports its shape (set / resolved) and never its
 * value, and that one unresolvable reference doesn't blank the rest of the bag.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const loadResource = vi.fn();
const listServiceEnvVars = vi.fn();
const resolveServiceEnv = vi.fn();

vi.mock("../context", () => ({ loadResource }));
vi.mock("../queries", () => ({ listServiceEnvVars }));
vi.mock("../../../lib/variables/resolver", () => ({ resolveServiceEnv }));

const { listEffectiveEnv } = await import("../env-effective");

const input = {
  projectId: idSchema.project.parse("prj_effective0000000000000"),
  resourceId: idSchema.resource.parse("res_effective0000000000000"),
  organizationId: idSchema.organization.parse("org_effective0000000000000"),
};

const call = () => listEffectiveEnv(input);

function row(over: Record<string, unknown> = {}) {
  return { key: "K", value: "v", isSecret: false, sealed: false, ...over };
}

beforeEach(() => {
  loadResource.mockResolvedValue(Result.ok({ record: {}, project: { slug: "shared" } }));
  listServiceEnvVars.mockReset();
  resolveServiceEnv.mockReset();
});

describe("listEffectiveEnv", () => {
  test("reports the resolved value and what was declared", async () => {
    listServiceEnvVars.mockResolvedValue([
      row({ key: "DB_URL", value: "postgres://${{db.HOST}}" }),
    ]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ DB_URL: "postgres://autumn-db" }));

    const out = await call();
    expect(out.isOk()).toBe(true);
    if (out.isErr()) return;
    expect(out.value).toEqual([
      {
        key: "DB_URL",
        value: "postgres://autumn-db",
        declared: "postgres://${{db.HOST}}",
        isSecret: false,
        sealed: false,
        unresolved: false,
      },
    ]);
  });

  test("never returns a secret's resolved value", async () => {
    listServiceEnvVars.mockResolvedValue([row({ key: "API_KEY", isSecret: true, value: "raw" })]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ API_KEY: "sk-live-do-not-leak" }));

    const out = await call();
    if (out.isErr()) return;
    const [first] = out.value;
    expect(first?.value).not.toContain("sk-live");
    expect(first?.value).toBe("••••••••");
    expect(first?.isSecret).toBe(true);
  });

  test("never returns a sealed row's decrypted value", async () => {
    listServiceEnvVars.mockResolvedValue([row({ key: "SEALED", sealed: true, value: "envelope" })]);
    // The resolver decrypts sealed rows for the deploy path.
    resolveServiceEnv.mockResolvedValue(Result.ok({ SEALED: "plaintext-secret" }));

    const out = await call();
    if (out.isErr()) return;
    const [first] = out.value;
    expect(first?.value).toBe("••••••••");
    expect(first?.declared).not.toBe("envelope");
  });

  test("a whole-bag resolver failure still lists every key, marked unresolved", async () => {
    listServiceEnvVars.mockResolvedValue([
      row({ key: "A", value: "${{missing.X}}" }),
      row({ key: "B", value: "plain" }),
    ]);
    resolveServiceEnv.mockResolvedValue(Result.err(new Error("RefMissingResourceError")));

    const out = await call();
    if (out.isErr()) return;
    // Falls back to the declared text rather than blanking the tab.
    expect(out.value.map((r) => [r.key, r.value, r.unresolved])).toEqual([
      ["A", "${{missing.X}}", true],
      ["B", "plain", true],
    ]);
  });

  test("sorts by key so the list does not reshuffle between reads", async () => {
    listServiceEnvVars.mockResolvedValue([row({ key: "Z" }), row({ key: "A" })]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ Z: "z", A: "a" }));
    const out = await call();
    if (out.isErr()) return;
    expect(out.value.map((r) => r.key)).toEqual(["A", "Z"]);
  });

  test("declared is null when the value contained no reference", async () => {
    listServiceEnvVars.mockResolvedValue([row({ key: "PLAIN", value: "same" })]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ PLAIN: "same" }));
    const out = await call();
    if (out.isErr()) return;
    expect(out.value[0]?.declared).toBeNull();
  });
});
