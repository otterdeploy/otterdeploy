import { describe, it, expect } from "vitest";
import { createRedactionFilter } from "../log-redaction";

describe("createRedactionFilter", () => {
  it("redacts known secret values", () => {
    const filter = createRedactionFilter(["my-super-secret"]);

    const result = filter.redact("The password is my-super-secret, do not share");

    expect(result).toBe("The password is [REDACTED], do not share");
    expect(result).not.toContain("my-super-secret");
  });

  it("redacts AWS access key patterns", () => {
    const filter = createRedactionFilter([]);

    const result = filter.redact("key=AKIAIOSFODNN7EXAMPLE");

    expect(result).toBe("key=[REDACTED]");
  });

  it("redacts JWT tokens", () => {
    const filter = createRedactionFilter([]);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-xyz";

    const result = filter.redact(`token: ${jwt}`);

    expect(result).toBe("token: [REDACTED]");
    expect(result).not.toContain("eyJ");
  });

  it("redacts Bearer tokens", () => {
    const filter = createRedactionFilter([]);

    const result = filter.redact("Authorization: Bearer sk-abc123.xyz/456=");

    expect(result).toBe("Authorization: [REDACTED]");
  });

  it("redacts credentials in URLs", () => {
    const filter = createRedactionFilter([]);

    const result = filter.redact("Connecting to https://admin:p4ssw0rd@db.example.com:5432/mydb");

    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("p4ssw0rd");
  });
});
