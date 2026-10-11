import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { SensitiveInput } from "./sensitive-input";
import { SensitiveValue } from "./sensitive-value";

/** The text a reader sees, without the markup between the parts. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");
}

const MASK = "••••••••••";

describe("SensitiveValue", () => {
  it("is masked by default, with reveal and copy", () => {
    const html = renderToStaticMarkup(<SensitiveValue label="server IP" value="203.0.113.41" />);
    expect(html).not.toContain("203.0.113.41");
    expect(html).toContain(MASK);
    expect(html).toContain('aria-label="Reveal server IP"');
    expect(html).toContain('aria-label="Copy server IP"');
  });

  it("uses one mask length whatever the value's length", () => {
    const short = renderToStaticMarkup(<SensitiveValue label="host" value="10.0.0.1" />);
    const long = renderToStaticMarkup(
      <SensitiveValue label="host" value="2001:db8:85a3::8a2e:370:7334" />,
    );
    expect(short.replace("10.0.0.1", "")).toBe(long.replace("2001:db8:85a3::8a2e:370:7334", ""));
  });

  it("keeps the prefix and suffix readable", () => {
    const html = renderToStaticMarkup(
      <SensitiveValue label="SSH host" value="203.0.113.41" prefix="root@" suffix=":22" />,
    );
    expect(html).toContain("root@");
    expect(html).toContain(":22");
    expect(html).not.toContain("203.0.113.41");
  });

  it("masks only the secret part of a longer value", () => {
    const html = renderToStaticMarkup(
      <SensitiveValue
        label="connection URL"
        value="postgresql://app:s3cr3t-pass@db.example.com/app"
        secret="s3cr3t-pass"
      />,
    );
    expect(textOf(html)).toContain(`postgresql://app:${MASK}@db.example.com/app`);
    expect(html).not.toContain("s3cr3t-pass");
  });

  it("masks everything when the secret is not where it was expected", () => {
    const html = renderToStaticMarkup(
      <SensitiveValue label="connection URL" value="postgresql://app@db/app" secret="elsewhere" />,
    );
    expect(html).not.toContain("db/app");
    expect(html).toContain(MASK);
  });

  it("offers nothing to reveal to a viewer the value was withheld from", () => {
    const html = renderToStaticMarkup(
      <SensitiveValue label="server IP" restricted="Only installation admins can see this" />,
    );
    expect(html).toContain(MASK);
    expect(html).toContain("Only installation admins can see this");
    expect(html).not.toContain("<button");
  });
});

describe("SensitiveInput", () => {
  it("masks what is typed until revealed", () => {
    const html = renderToStaticMarkup(
      <SensitiveInput label="host" value="203.0.113.41" onChange={() => {}} />,
    );
    expect(html).toContain("[-webkit-text-security:disc]");
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Reveal host"');
  });
});
