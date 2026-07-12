import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { Markdown } from "./markdown";

const html = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe("Markdown", () => {
  it("renders headings by level", () => {
    const out = html("# One\n\n## Two\n\n### Three");
    expect(out).toContain("<h1");
    expect(out).toContain(">One</h1>");
    expect(out).toContain("<h2");
    expect(out).toContain(">Two</h2>");
    expect(out).toContain(">Three</h3>");
  });

  it("renders bullet and numbered lists", () => {
    const ul = html("- first\n- second");
    expect(ul).toContain("<ul");
    expect((ul.match(/<li/g) ?? []).length).toBe(2);
    const ol = html("1. one\n2. two");
    expect(ol).toContain("<ol");
    expect((ol.match(/<li/g) ?? []).length).toBe(2);
  });

  it("renders bold, italic, strikethrough and inline code", () => {
    expect(html("**bold**")).toContain("<strong");
    expect(html("_italic_")).toContain("<em");
    expect(html("~~gone~~")).toContain("<s");
    expect(html("use `bun run`")).toContain("<code");
  });

  it("renders markdown links with a safe href and _blank", () => {
    const out = html("see [the docs](https://otterdeploy.dev/docs)");
    expect(out).toContain('href="https://otterdeploy.dev/docs"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("the docs</a>");
  });

  it("autolinks bare URLs (the GitHub 'Full Changelog' line)", () => {
    const out = html(
      "**Full Changelog**: https://github.com/otterdeploy/otterdeploy/compare/v0.4.2...v0.4.3",
    );
    expect(out).toContain("<strong");
    expect(out).toContain(
      'href="https://github.com/otterdeploy/otterdeploy/compare/v0.4.2...v0.4.3"',
    );
  });

  it("refuses unsafe link schemes (no javascript: href)", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
    expect(out).toContain("click");
  });

  it("never emits raw HTML from the source (XSS-safe)", () => {
    const out = html("hello <img src=x onerror=alert(1)> world");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("renders fenced code blocks verbatim", () => {
    const out = html("```\nSTATUS=running\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("<code>STATUS=running</code>");
  });

  it("renders a horizontal rule and blockquote", () => {
    expect(html("---")).toContain("<hr");
    expect(html("> quoted")).toContain("<blockquote");
  });

  it("renders nothing for empty or whitespace input", () => {
    expect(html("")).toBe("");
    expect(html("   \n  ")).toBe("");
  });

  it("handles a realistic GitHub release body", () => {
    const body = [
      "## What's Changed",
      "",
      "- fix(logs): stop rows overlapping by @artzkaizen in #41",
      "- feat(db): live image-pull progress",
      "",
      "**Full Changelog**: https://github.com/otterdeploy/otterdeploy/compare/v0.4.2...v0.4.3",
    ].join("\n");
    const out = html(body);
    expect(out).toContain(">What&#x27;s Changed</h2>");
    expect((out.match(/<li/g) ?? []).length).toBe(2);
    expect(out).toContain("<strong");
    expect(out).toContain(
      'href="https://github.com/otterdeploy/otterdeploy/compare/v0.4.2...v0.4.3"',
    );
  });
});
