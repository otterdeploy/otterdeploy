import { describe, expect, test } from "vite-plus/test";

import { editedExposedHost, exposedHostFor } from "./exposed-host";

/**
 * The domain field exists because `editedExposedHost` only reaches templates
 * that declare an address-shaped variable. Authentik declares SECRET_KEY and
 * POSTGRES_PASSWORD and nothing else, so it had no domain control at all.
 */
describe("exposedHostFor", () => {
  test("uses the domain field when set", () => {
    expect(exposedHostFor({ variables: [], domain: "https://auth.example.com/path" })).toBe(
      "auth.example.com",
    );
  });

  test("gives a template with no address variable a domain at last", () => {
    const authentikVars = [
      { value: "s3cret" }, // SECRET_KEY
      { value: "pgpass" }, // POSTGRES_PASSWORD
    ];
    expect(editedExposedHost(authentikVars)).toBeNull();
    expect(exposedHostFor({ variables: authentikVars, domain: "auth.example.com" })).toBe(
      "auth.example.com",
    );
  });

  test("falls back to an edited address variable when the field is blank", () => {
    expect(
      exposedHostFor({
        variables: [
          { value: "https://typed.example.com", seedValue: "https://seeded.example.com" },
        ],
        domain: "",
      }),
    ).toBe("typed.example.com");
  });

  test("is null when neither is set, so the generated host stays canonical", () => {
    expect(
      exposedHostFor({
        variables: [
          { value: "https://seeded.example.com", seedValue: "https://seeded.example.com" },
        ],
        domain: "",
      }),
    ).toBeNull();
  });
});
