import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { PublicConnectionUrlRow } from "./public-connection-url";

/** The text a reader sees, without the markup between the parts. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");
}

describe("PublicConnectionUrlRow", () => {
  it("masks the password, keeping the user, host and database readable", () => {
    const html = renderToStaticMarkup(
      <PublicConnectionUrlRow
        url="postgresql://app:Zk9-pass@db-shop.acme.dev/app?sslmode=require"
        password="Zk9-pass"
      />,
    );
    expect(html).not.toContain("Zk9-pass");
    expect(textOf(html)).toContain(
      "postgresql://app:••••••••••@db-shop.acme.dev/app?sslmode=require",
    );
  });

  it("finds a password the URL carries percent-encoded", () => {
    const html = renderToStaticMarkup(
      <PublicConnectionUrlRow
        url="postgresql://app:p%40ss%2Fword@db-shop.acme.dev/app"
        password="p@ss/word"
      />,
    );
    expect(html).not.toContain("p%40ss%2Fword");
    expect(textOf(html)).toContain("postgresql://app:••••••••••@db-shop.acme.dev/app");
  });
});
