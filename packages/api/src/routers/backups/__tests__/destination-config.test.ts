import { describe, expect, test } from "vitest";

import { missingConfigKeys, missingSecret } from "../destination-config";

describe("missingConfigKeys", () => {
  test("local with no path ⇒ path missing (the shipped-broken shape)", () => {
    expect(missingConfigKeys("local", {})).toEqual(["path"]);
    expect(missingConfigKeys("local", undefined)).toEqual(["path"]);
  });

  test("blank / whitespace values count as missing", () => {
    expect(missingConfigKeys("local", { path: "" })).toEqual(["path"]);
    expect(missingConfigKeys("local", { path: "   " })).toEqual(["path"]);
    expect(missingConfigKeys("s3", { bucket: "" })).toEqual(["bucket"]);
  });

  test("complete configs pass", () => {
    expect(missingConfigKeys("local", { path: "/var/backups" })).toEqual([]);
    expect(missingConfigKeys("s3", { bucket: "b", region: "us-east-1" })).toEqual([]);
    expect(missingConfigKeys("sftp", { host: "backup.example.com" })).toEqual([]);
  });

  test("non-string present values (e.g. numeric port) are not flagged", () => {
    expect(missingConfigKeys("sftp", { host: "h", port: 22 })).toEqual([]);
  });
});

describe("missingSecret", () => {
  test("local never requires a secret", () => {
    expect(missingSecret("local", undefined)).toBe(false);
    expect(missingSecret("local", {})).toBe(false);
  });

  test("s3/sftp require at least one non-blank credential value", () => {
    expect(missingSecret("s3", undefined)).toBe(true);
    expect(missingSecret("s3", { accessKeyId: " " })).toBe(true);
    expect(missingSecret("s3", { accessKeyId: "k", secretAccessKey: "s" })).toBe(false);
    expect(missingSecret("sftp", { password: "p" })).toBe(false);
  });
});
