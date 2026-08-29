import { describe, expect, it } from "vite-plus/test";

import { suggestionsFromEnvSpec } from "../from-env-spec";

const SCHEMA = `# @defaultSensitive=false
# ---
# Signs session tokens. Rotating it signs every user out.
# @required @sensitive @type=string(minLength=32)
JWT_SECRET=

# @type=enum(local, cloudflare)
STORAGE_PROVIDER=local

# @docs("LinkedIn provider setup", https://docs.postiz.com/providers/linkedin)
LINKEDIN_CLIENT_ID=

# @required @type=url
MAIN_URL=\${{stack.postiz.PUBLIC_URL}}

# @type=number
API_LIMIT=30
`;

describe("suggestionsFromEnvSpec", () => {
  const byKey = new Map(suggestionsFromEnvSpec(SCHEMA).map((s) => [s.key, s]));

  it("carries the comment as the description and the flags as badges", () => {
    const jwt = byKey.get("JWT_SECRET");
    expect(jwt?.description).toBe("Signs session tokens. Rotating it signs every user out.");
    expect(jwt?.secret).toBe(true);
    expect(jwt?.required).toBe(true);
  });

  it("prefills a static default, never a ref and never a secret", () => {
    expect(byKey.get("STORAGE_PROVIDER")?.defaultValue).toBe("local");
    expect(byKey.get("API_LIMIT")?.defaultValue).toBe("30");
    expect(byKey.get("MAIN_URL")?.defaultValue).toBeUndefined();
    expect(byKey.get("JWT_SECRET")?.defaultValue).toBeUndefined();
  });

  it("extracts the docs URL from a labelled @docs", () => {
    expect(byKey.get("LINKEDIN_CLIENT_ID")?.docsUrl).toBe(
      "https://docs.postiz.com/providers/linkedin",
    );
  });

  describe("validate", () => {
    it("blocks a required value that is empty or malformed", () => {
      const v = byKey.get("JWT_SECRET")?.validate;
      expect(v?.("")).toEqual({ level: "block", message: "required" });
      expect(v?.("short")?.level).toBe("block");
      expect(v?.("x".repeat(32))).toBeNull();
    });

    it("only warns for an optional value that looks wrong", () => {
      const v = byKey.get("STORAGE_PROVIDER")?.validate;
      expect(v?.("s3")).toEqual({ level: "warn", message: "expected one of: local, cloudflare" });
      expect(v?.("")).toBeNull();
    });

    // A reference resolves at deploy; the editor cannot know its shape and
    // must not nag about it. This is the MAIN_URL case from the template.
    it("never flags a reference value", () => {
      const v = byKey.get("MAIN_URL")?.validate;
      expect(v?.("${{stack.postiz.PUBLIC_URL}}")).toBeNull();
      expect(v?.("${POSTIZ_URL}")).toBeNull();
      expect(v?.("not a url")?.level).toBe("block");
    });
  });
});
