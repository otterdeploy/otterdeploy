import { describe, expect, test } from "bun:test";

import {
  buildRootCaddyfile,
  extractClaimsFromHttpJson,
  extractClaimsFromLayer4Json,
  validateClaimConflicts,
  validateProjectScope,
  type ProjectCaddySnapshot,
} from "./config";

describe("caddy-config", () => {
  test("builds a root wrapper that imports project files", () => {
    const output = buildRootCaddyfile(
      "/etc/caddy",
      [
        {
          projectId: "alpha",
          httpCaddyfile: "alpha.example.com { reverse_proxy 127.0.0.1:3000 }",
          layer4Caddyfile: "",
        },
        {
          projectId: "beta",
          httpCaddyfile: "",
          layer4Caddyfile: ":5432 { route { proxy 10.0.0.2:5432 } }",
        },
      ],
      "127.0.0.1:2019",
    );

    expect(output).toContain("admin 127.0.0.1:2019");
    expect(output).toContain("import /etc/caddy/projects/alpha/http.caddy");
    expect(output).toContain("import /etc/caddy/projects/beta/layer4.caddy");
  });

  test("rejects project-scoped configs that try to define global or bare HTTP listeners", () => {
    const issues = validateProjectScope({
      projectId: "alpha",
      httpCaddyfile: "{\n\tadmin off\n}\n\n:8080 {\n\treverse_proxy 127.0.0.1:3000\n}",
      layer4Caddyfile: "{\n\tadmin off\n}",
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      "http.global_block_forbidden",
      "layer4.global_block_forbidden",
      "http.hostname_required",
    ]);
  });

  test("extracts HTTP host claims from adapted JSON", () => {
    const claims = extractClaimsFromHttpJson({
      apps: {
        http: {
          servers: {
            srv0: {
              routes: [
                {
                  match: [{ host: ["app.example.com"] }],
                  handle: [{ handler: "reverse_proxy" }],
                },
              ],
            },
          },
        },
      },
    });

    expect(claims.httpHosts).toEqual(["app.example.com"]);
  });

  test("extracts layer4 listener and SNI claims from adapted JSON", () => {
    const claims = extractClaimsFromLayer4Json({
      apps: {
        layer4: {
          servers: {
            pg: {
              listen: [":5432"],
              routes: [
                {
                  match: [{ tls: { sni: ["db.example.com"] } }],
                  handle: [{ handler: "proxy" }],
                },
              ],
            },
          },
        },
      },
    });

    expect(claims.layer4Listeners).toEqual([":5432"]);
    expect(claims.layer4Snis).toEqual(["db.example.com"]);
  });

  test("detects reserved and cross-project conflicts", () => {
    const snapshot: ProjectCaddySnapshot = {
      projectId: "alpha",
      httpCaddyfile: "",
      layer4Caddyfile: "",
    };

    const issues = validateClaimConflicts(
      snapshot,
      {
        httpHosts: ["api.otterstack.io", "alpha.example.com"],
        layer4Listeners: [":5432"],
        layer4Snis: ["db.alpha.example.com"],
      },
      new Map([
        [
          "beta",
          {
            httpHosts: ["alpha.example.com"],
            layer4Listeners: [":5432"],
            layer4Snis: ["db.beta.example.com"],
          },
        ],
      ]),
      new Set(["api.otterstack.io"]),
      new Set(["5432"]),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      "http.reserved_host",
      "http.host_conflict",
      "layer4.reserved_listener",
      "layer4.listener_conflict",
    ]);
  });
});
