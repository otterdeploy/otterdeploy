import { describe, it, expect } from "vitest";
import { createRedactionFilter } from "../log-redaction";

describe("P0 Security: Secret Redaction", () => {
  it("redacts known secret values from log output", () => {
    const filter = createRedactionFilter(["my-secret-password", "api-key-12345"]);

    const input = "Connecting with password my-secret-password to database";
    const output = filter.redact(input);

    expect(output).not.toContain("my-secret-password");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts AWS access key patterns", () => {
    const filter = createRedactionFilter([]);

    const input = "Using AWS key AKIAIOSFODNN7EXAMPLE for S3";
    const output = filter.redact(input);

    expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts JWT token patterns", () => {
    const filter = createRedactionFilter([]);

    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Authorization: Bearer ${jwt}`;
    const output = filter.redact(input);

    expect(output).not.toContain(jwt);
    expect(output).toContain("[REDACTED]");
  });

  it("redacts Bearer token patterns", () => {
    const filter = createRedactionFilter([]);

    const input = "Authorization: Bearer ghp_xxxxxxxxxxxxxxxxxxx";
    const output = filter.redact(input);

    expect(output).toContain("[REDACTED]");
  });

  it("does not redact normal text", () => {
    const filter = createRedactionFilter(["secret123"]);

    const input = "Building image otterstack-abc123:v1";
    const output = filter.redact(input);

    expect(output).toBe(input);
  });

  it("handles multiple secrets in one line", () => {
    const filter = createRedactionFilter(["password1", "apikey2"]);

    const input = "DB_PASS=password1 API_KEY=apikey2";
    const output = filter.redact(input);

    expect(output).not.toContain("password1");
    expect(output).not.toContain("apikey2");
  });
});
