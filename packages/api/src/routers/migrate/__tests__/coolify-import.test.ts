/**
 * od-b34a: Coolify import unit coverage.
 *
 * The Laravel decryptor is tested against payloads produced HERE with the
 * exact algorithm Laravel's Encrypter uses (AES-256-CBC + HMAC-SHA256 over
 * iv_b64+value_b64), including the PHP-serialized variant and the hostile
 * cases: wrong key, tampered MAC, and plaintext lookalikes. The plan
 * mappers are tested on the shapes Coolify actually stores (comma fqdn
 * lists, git@ remotes, display names), and buildManifest must reject
 * nothing the mappers produce.
 */
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { describe, expect, test } from "vite-plus/test";

import { buildManifest, toProjectSlug } from "../apply";
import { normalizeDomains, normalizeRepo, toResourceName } from "../coolify";
import { decryptLaravelValue, looksLaravelEncrypted, parseAppKey } from "../laravel-crypt";

/** Mirror of Laravel Encrypter::encryptString (serialize=false). */
function laravelEncrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const value = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString(
    "base64",
  );
  const ivB64 = iv.toString("base64");
  const mac = createHmac("sha256", key)
    .update(ivB64 + value)
    .digest("hex");
  return Buffer.from(JSON.stringify({ iv: ivB64, value, mac }), "utf8").toString("base64");
}

const APP_KEY = `base64:${randomBytes(32).toString("base64")}`;
const key = parseAppKey(APP_KEY);
if (key.isErr()) throw new Error("fixture APP_KEY failed to parse");

describe("laravel-crypt", () => {
  test("round-trips encryptString payloads (the `encrypted` cast)", () => {
    for (const input of ["", "postgres://u:p@h/db", "line1\nline2", "🦦 ünïcode"]) {
      const decrypted = decryptLaravelValue(laravelEncrypt(input, key.value), key.value);
      expect(decrypted.isOk() && decrypted.value).toBe(input);
    }
  });

  test("unwraps PHP-serialized payloads (Crypt::encrypt with serialize)", () => {
    const serialized = 's:12:"hello coolif";';
    const decrypted = decryptLaravelValue(laravelEncrypt(serialized, key.value), key.value);
    expect(decrypted.isOk() && decrypted.value).toBe("hello coolif");
  });

  test("rejects the wrong key and tampered MACs instead of yielding garbage", () => {
    const other = parseAppKey(`base64:${randomBytes(32).toString("base64")}`);
    if (other.isErr()) throw new Error("fixture key failed");
    const payload = laravelEncrypt("secret", key.value);
    expect(decryptLaravelValue(payload, other.value).isErr()).toBe(true);

    const parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    parsed.mac = parsed.mac.replace(/^./, parsed.mac.startsWith("a") ? "b" : "a");
    const tampered = Buffer.from(JSON.stringify(parsed)).toString("base64");
    expect(decryptLaravelValue(tampered, key.value).isErr()).toBe(true);
  });

  test("parseAppKey rejects short keys; looksLaravelEncrypted spots the shape", () => {
    expect(parseAppKey("base64:dG9vc2hvcnQ=").isErr()).toBe(true);
    expect(looksLaravelEncrypted(laravelEncrypt("x", key.value))).toBe(true);
    expect(looksLaravelEncrypted("plain-value")).toBe(false);
    expect(looksLaravelEncrypted("postgres://user:pw@host/db")).toBe(false);
  });
});

describe("coolify plan mappers", () => {
  test("normalizeRepo handles https, git@, .git, and bare owner/repo", () => {
    expect(normalizeRepo("https://github.com/acme/shop")).toBe("acme/shop");
    expect(normalizeRepo("https://github.com/acme/shop.git")).toBe("acme/shop");
    expect(normalizeRepo("git@github.com:acme/shop.git")).toBe("acme/shop");
    expect(normalizeRepo("acme/shop")).toBe("acme/shop");
    expect(normalizeRepo("https://gitlab.example.com/group/sub/repo")).toBeNull();
    expect(normalizeRepo(null)).toBeNull();
  });

  test("normalizeDomains splits Coolify's comma fqdn list and strips schemes/paths", () => {
    expect(normalizeDomains("https://a.example.com,http://b.example.com/health")).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
    expect(normalizeDomains(null)).toEqual([]);
  });

  test("toResourceName and toProjectSlug produce grammar-valid identifiers", () => {
    expect(toResourceName("My Shop API!", "app-1")).toBe("my-shop-api");
    expect(toResourceName("42 服务", "app-7")).toBe("app-7");
    expect(toProjectSlug("Acme Örp")).toBe("acme-rp");
    expect(toProjectSlug("Ü")).toBe("imported-");
  });
});

describe("buildManifest", () => {
  test("a full planned project validates against the manifest schema", () => {
    const manifest = buildManifest("acme-shop", {
      name: "Acme Shop",
      services: [
        {
          name: "web",
          repo: "acme/shop",
          branch: "main",
          buildPack: "dockerfile",
          dockerfilePath: "./Dockerfile.prod",
          sourceSubdir: "apps/web",
          port: 3000,
          domains: ["shop.example.com", "www.example.com"],
          env: [{ key: "API_URL", value: "https://api.example.com" }],
          warnings: [],
        },
        // Unbound repo + duplicate name: still valid, just suffixed.
        {
          name: "web",
          repo: null,
          branch: null,
          buildPack: "nixpacks",
          dockerfilePath: null,
          sourceSubdir: null,
          port: null,
          domains: [],
          env: [],
          warnings: [],
        },
      ],
      databases: [{ name: "shop-db", engine: "postgres" }],
    });
    expect(manifest.isOk()).toBe(true);
    if (manifest.isErr()) return;
    expect(Object.keys(manifest.value.services)).toEqual(["web", "web-2"]);
    const web = manifest.value.services.web;
    expect(web?.source).toBe("git");
    if (web?.source !== "git") return;
    expect(web.repo).toBe("acme/shop");
    expect(web.build).toEqual({ builder: "dockerfile", dockerfilePath: "./Dockerfile.prod" });
    expect(web.domains?.[0]).toEqual({ domain: "shop.example.com", primary: true });
    expect(manifest.value.databases["shop-db"]?.engine).toBe("postgres");
  });
});
