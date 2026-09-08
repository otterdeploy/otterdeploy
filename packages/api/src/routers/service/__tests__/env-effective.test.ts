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

/**
 * Regression: the flags are not a reliable signal.
 *
 * Masking used to key off `isSecret || sealed` alone. Manifest-applied
 * variables set NEITHER, so on a real install every row carried
 * `is_secret=f, sealed=f` — and the endpoint happily resolved a vault
 * reference and a postgres connection string and returned both in cleartext.
 * What a reference DEREFERENCES is the signal that matters.
 */
describe("references that dereference a secret", () => {
  test("a vault reference is masked even with both flags false", async () => {
    listServiceEnvVars.mockResolvedValue([
      row({ key: "BETTER_AUTH_SECRET", value: "${{vault.praxly-prod.BETTER_AUTH_SECRET}}" }),
    ]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ BETTER_AUTH_SECRET: "2cb53385db6968c8e2b" }));

    const out = await call();
    const [entry] = out.unwrap();
    expect(entry.value).toBe("••••••••");
    expect(entry.value).not.toContain("2cb53385");
    // The reference itself is not the secret, so it stays readable.
    expect(entry.declared).toBe("${{vault.praxly-prod.BETTER_AUTH_SECRET}}");
  });

  test("a DATABASE_URL reference is masked: a connection string embeds the password", async () => {
    listServiceEnvVars.mockResolvedValue([
      row({ key: "DATABASE_URL", value: "${{postgres-prod.DATABASE_URL}}" }),
    ]);
    resolveServiceEnv.mockResolvedValue(
      Result.ok({ DATABASE_URL: "postgresql://user:fXzXjQwzeuN2epWmaN@host:5432/db" }),
    );

    const [entry] = (await call()).unwrap();
    expect(entry.value).toBe("••••••••");
    expect(entry.value).not.toContain("fXzXjQwzeuN2epWmaN");
  });

  test("a non-credential reference still shows what it resolved to", async () => {
    // The surface exists to answer "is this pointing at the right database".
    // Masking every reference would take that away for no security gain.
    listServiceEnvVars.mockResolvedValue([row({ key: "DB_HOST", value: "${{db.HOST}}" })]);
    resolveServiceEnv.mockResolvedValue(Result.ok({ DB_HOST: "autumn-db" }));

    const [entry] = (await call()).unwrap();
    expect(entry.value).toBe("autumn-db");
  });

  test("an unresolved secret reference is not masked: nothing was dereferenced", async () => {
    listServiceEnvVars.mockResolvedValue([row({ key: "S", value: "${{vault.x.MISSING}}" })]);
    resolveServiceEnv.mockResolvedValue(Result.err(new Error("vault down")));

    const [entry] = (await call()).unwrap();
    expect(entry.unresolved).toBe(true);
    // Showing the declared text is the whole point of opening the panel.
    expect(entry.value).toBe("${{vault.x.MISSING}}");
  });
});
