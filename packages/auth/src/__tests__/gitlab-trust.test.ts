import { describe, expect, test } from "bun:test";

import {
  TRUSTED_LINKING_PROVIDERS,
  createGitlabProviderOptions,
  gitlabEmailVerified,
  isGitlabComIssuer,
} from "../gitlab-trust";

describe("GitLab email trust", () => {
  test("gitlab is never trusted for linking by name", () => {
    expect(TRUSTED_LINKING_PROVIDERS).not.toContain("gitlab");
  });

  test("only gitlab.com (or no issuer, better-auth's default) is gitlab.com", () => {
    expect(isGitlabComIssuer(undefined)).toBe(true);
    expect(isGitlabComIssuer("https://gitlab.com")).toBe(true);
    expect(isGitlabComIssuer("https://gitlab.com/")).toBe(true);
    expect(isGitlabComIssuer("https://gitlab.example.com")).toBe(false);
    expect(isGitlabComIssuer("https://gitlab.com.evil.test")).toBe(false);
    expect(isGitlabComIssuer("http://gitlab.com")).toBe(false);
    expect(isGitlabComIssuer("not a url")).toBe(false);
  });

  test("a confirmed gitlab.com email is verified; anything else is not", () => {
    const confirmed = { confirmed_at: "2026-01-01T00:00:00.000Z" };
    expect(gitlabEmailVerified(undefined, confirmed)).toBe(true);
    expect(gitlabEmailVerified(undefined, { confirmed_at: null })).toBe(false);
    expect(gitlabEmailVerified(undefined, {})).toBe(false);
    expect(gitlabEmailVerified("https://gitlab.example.com", confirmed)).toBe(false);
  });

  test("the provider options carry the rule into better-auth's profile mapping", () => {
    const options = createGitlabProviderOptions({
      clientId: "id",
      clientSecret: "secret",
      issuer: "https://gitlab.example.com",
    });
    expect(options.mapProfileToUser({ confirmed_at: "2026-01-01" })).toEqual({
      emailVerified: false,
    });
  });
});
