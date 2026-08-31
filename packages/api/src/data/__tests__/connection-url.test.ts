import { describe, expect, it } from "vite-plus/test";

import {
  describeConnection,
  parseConnectionUrl,
  resolveConnectionAddress,
} from "../connection-url";

const ok = (raw: string) => {
  const out = parseConnectionUrl(raw);
  if (out.isErr()) throw new Error(`expected ok, got ${out.error.reason}: ${out.error.message}`);
  return out.value;
};
const reason = (raw: string, opts?: { allowPrivateAddresses?: boolean }) => {
  const out = parseConnectionUrl(raw, opts);
  return out.isErr() ? out.error.reason : null;
};

describe("parsing", () => {
  it("reads a Neon-style postgres URL", () => {
    const p = ok(
      "postgresql://alice:s3cr3t@ep-cool-1.eu-central-1.aws.neon.tech/shop?sslmode=require",
    );
    expect(p).toMatchObject({
      engine: "postgres",
      host: "ep-cool-1.eu-central-1.aws.neon.tech",
      port: 5432,
      database: "shop",
      username: "alice",
      password: "s3cr3t",
      sslRequested: true,
    });
  });

  it("maps mysql:// and mariadb:// onto the one dialect that serves both", () => {
    expect(ok("mysql://u:p@db.example.com/app").engine).toBe("mariadb");
    expect(ok("mariadb://u:p@db.example.com:3307/app")).toMatchObject({
      engine: "mariadb",
      port: 3307,
    });
  });

  it("percent-decodes a password, which is where special characters live", () => {
    expect(ok("postgres://u:p%40ss%3Aword@db.example.com/app").password).toBe("p@ss:word");
  });

  it("treats sslmode=disable as not requesting TLS", () => {
    expect(ok("postgres://u:p@db.example.com/app?sslmode=disable").sslRequested).toBe(false);
    expect(ok("postgres://u:p@db.example.com/app").sslRequested).toBe(false);
  });
});

describe("SSRF: the address is checked before anything opens a socket", () => {
  it("refuses loopback", () => {
    // The control plane's own services live here.
    for (const host of ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]) {
      expect(reason(`postgres://u:p@${host}/app`)).toBe("blocked_host");
    }
  });

  it("refuses the cloud metadata address", () => {
    // The single most valuable thing an SSRF can reach.
    expect(reason("postgres://u:p@169.254.169.254/app")).toBe("blocked_host");
    expect(reason("postgres://u:p@metadata.google.internal/app")).toBe("blocked_host");
  });

  it("refuses private ranges, which is where other tenants are", () => {
    for (const host of ["10.0.0.5", "172.16.4.2", "172.31.255.1", "192.168.1.9", "100.64.0.1"]) {
      expect(reason(`postgres://u:p@${host}/app`)).toBe("blocked_host");
    }
  });

  it("refuses IPv6 loopback, link-local and unique-local", () => {
    for (const host of ["[::1]", "[fe80::1]", "[fd00::1]", "[fc00::1]"]) {
      expect(reason(`postgres://u:p@${host}/app`)).toBe("blocked_host");
    }
  });

  it("refuses IPv4-mapped IPv6 loopback", () => {
    expect(reason("postgres://u:p@[::ffff:127.0.0.1]/app")).toBe("blocked_host");
  });

  it("allows public addresses", () => {
    expect(reason("postgres://u:p@db.example.com/app")).toBeNull();
    expect(reason("postgres://u:p@8.8.8.8/app")).toBeNull();
    // 172.32 is OUTSIDE the private 172.16–172.31 block.
    expect(reason("postgres://u:p@172.32.0.1/app")).toBeNull();
  });

  it("opens private ranges only when the instance deliberately allows it", () => {
    expect(reason("postgres://u:p@10.0.0.5/app", { allowPrivateAddresses: true })).toBeNull();
    expect(reason("postgres://u:p@localhost/app", { allowPrivateAddresses: true })).toBeNull();
  });

  it("validates and pins the address used for the connection", async () => {
    const blocked = await resolveConnectionAddress("127.0.0.1");
    expect(blocked.isErr() && blocked.error.reason).toBe("blocked_host");

    const allowed = await resolveConnectionAddress("127.0.0.1", {
      allowPrivateAddresses: true,
    });
    expect(allowed.isOk() && allowed.value).toEqual({
      address: "127.0.0.1",
      serverName: null,
    });
  });
});

describe("rejections that are the user's typo, not an attack", () => {
  it("names an unsupported scheme rather than failing obscurely", () => {
    expect(reason("redis://u:p@db.example.com/0")).toBe("unsupported_scheme");
    expect(reason("http://db.example.com/app")).toBe("unsupported_scheme");
  });

  it("requires a database name", () => {
    expect(reason("postgres://u:p@db.example.com")).toBe("missing_database");
    expect(reason("postgres://u:p@db.example.com/")).toBe("missing_database");
  });

  it("rejects a string that is not a URL at all", () => {
    expect(reason("host=db.example.com user=alice")).toBe("malformed");
    expect(reason("")).toBe("malformed");
  });
});

describe("describeConnection", () => {
  it("reveals the host and database and nothing else", () => {
    const p = ok("postgres://alice:s3cr3t@db.example.com:5433/shop");
    const described = describeConnection(p);
    expect(described).toEqual({ displayHost: "db.example.com:5433", displayDatabase: "shop" });
    // The label goes in a list every org member can read.
    expect(JSON.stringify(described)).not.toContain("s3cr3t");
    expect(JSON.stringify(described)).not.toContain("alice");
  });
});
