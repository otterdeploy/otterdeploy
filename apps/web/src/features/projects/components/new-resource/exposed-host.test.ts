import { describe, expect, test } from "vite-plus/test";

import { editedExposedHost, exposedHostsFor } from "./exposed-host";

const FRONT = "dashboard:3000";
const SECOND = "status-page:3000";

/**
 * The domain rows exist because `editedExposedHost` only reaches templates
 * that declare an address-shaped variable. Authentik declares SECRET_KEY and
 * POSTGRES_PASSWORD and nothing else, so it had no domain control at all.
 *
 * They are per service because a stack has as many hostnames as it has exposed
 * services. One box seeded from the first port-publishing service, applied to
 * the first exposed entry only, is what showed openstatus an internal database
 * as "the" domain and generated six more the operator never saw.
 */
describe("exposedHostsFor", () => {
  test("uses each service's own row, stripped to a hostname", () => {
    expect(
      exposedHostsFor(
        {
          variables: [],
          domains: [
            { key: FRONT, domain: "https://app.example.com/path" },
            { key: SECOND, domain: "status.example.com" },
          ],
        },
        [FRONT, SECOND],
      ),
    ).toEqual({ [FRONT]: "app.example.com", [SECOND]: "status.example.com" });
  });

  test("gives a template with no address variable a domain at last", () => {
    const authentikVars = [
      { value: "s3cret" }, // SECRET_KEY
      { value: "pgpass" }, // POSTGRES_PASSWORD
    ];
    expect(editedExposedHost(authentikVars)).toBeNull();
    expect(
      exposedHostsFor(
        { variables: authentikVars, domains: [{ key: FRONT, domain: "auth.example.com" }] },
        [FRONT],
      ),
    ).toEqual({ [FRONT]: "auth.example.com" });
  });

  test("falls back to an edited address variable, but only for the front door", () => {
    const vars = {
      variables: [{ value: "https://typed.example.com", seedValue: "https://seeded.example.com" }],
      domains: [
        { key: FRONT, domain: "" },
        { key: SECOND, domain: "" },
      ],
    };
    expect(exposedHostsFor(vars, [FRONT, SECOND])).toEqual({ [FRONT]: "typed.example.com" });
  });

  test("omits a service with no hostname, so the server keeps generating one", () => {
    expect(
      exposedHostsFor(
        {
          variables: [
            { value: "https://seeded.example.com", seedValue: "https://seeded.example.com" },
          ],
          domains: [
            { key: FRONT, domain: "" },
            { key: SECOND, domain: "status.example.com" },
          ],
        },
        [FRONT, SECOND],
      ),
    ).toEqual({ [SECOND]: "status.example.com" });
  });
});
