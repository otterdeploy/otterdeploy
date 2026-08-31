/**
 * od-i3p: a vault token in a project variable has to resolve before compose
 * interpolates it.
 *
 * Compose reads project variables through shell-style `${VAR}` and substitutes
 * them into EVERY string field — image, command, entrypoint, ports. That regex
 * does not match `${{vault…}}`, and those fields never reach
 * `resolveServiceEnv`, so the container was handed the literal token as its
 * image tag.
 *
 * The env half already worked and stays untouched: a vault token in a compose
 * service's env passes through to the service_env_var row and resolves at
 * deploy. These pin the half that never got there.
 */
import { Result } from "better-result";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const loadVaultValues = vi.fn();
const createVaultState = vi.fn();

vi.mock("../../../lib/variables/vault-resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/variables/vault-resolve")>();
  return { ...actual, loadVaultValues, createVaultState };
});

const { resolveVaultInProjectVars } = await import("../vault-project-vars");

/** A state whose `values` map already holds what the fake load "fetched".
 *  Keyed the way vault-resolve keys it: `provider\0ref`. */
function stateWith(values: Array<[provider: string, ref: string, value: string]>) {
  const map = new Map<string, string>();
  for (const [provider, ref, value] of values) map.set(`${provider}\u0000${ref}`, value);
  return { organizationId: "org_x", providers: new Map(), values: map };
}

beforeEach(() => {
  loadVaultValues.mockReset();
  createVaultState.mockReset();
});

describe("resolveVaultInProjectVars", () => {
  test("leaves a bag with no vault tokens completely alone, and does not call the provider", async () => {
    const vars = { PLAIN: "1", REF: "${{project.OTHER}}" };
    await expect(resolveVaultInProjectVars(vars, "org_x")).resolves.toBe(vars);
    expect(loadVaultValues).not.toHaveBeenCalled();
  });

  test("substitutes a resolved vault value", async () => {
    createVaultState.mockReturnValue(stateWith([["aws", "prod/db", "s3cret"]]));
    loadVaultValues.mockResolvedValue(Result.ok(true));

    const out = await resolveVaultInProjectVars(
      { DB_PASSWORD: "${{vault.aws.prod/db}}", PLAIN: "x" },
      "org_x",
    );
    expect(out.DB_PASSWORD).toBe("s3cret");
    // Untouched keys survive verbatim.
    expect(out.PLAIN).toBe("x");
  });

  test("a provider failure leaves every value as written rather than failing the deploy", async () => {
    createVaultState.mockReturnValue(stateWith([]));
    loadVaultValues.mockResolvedValue(Result.err(new Error("provider unreachable")));

    const vars = { DB_PASSWORD: "${{vault.aws.prod/db}}" };
    const out = await resolveVaultInProjectVars(vars, "org_x");
    expect(out).toBe(vars);
  });

  test("resolves a token embedded in a larger string", async () => {
    createVaultState.mockReturnValue(stateWith([["aws", "host", "db.internal"]]));
    loadVaultValues.mockResolvedValue(Result.ok(true));

    const out = await resolveVaultInProjectVars(
      { URL: "postgres://user@${{vault.aws.host}}:5432/x" },
      "org_x",
    );
    expect(out.URL).toBe("postgres://user@db.internal:5432/x");
  });
});
