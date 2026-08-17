/**
 * Render assertions for the public protection screens.
 *
 * These pages are the first thing anyone outside the team ever sees, they are
 * server-rendered strings with no component test harness, and nothing else in
 * the suite touches them, so a regression here ships silently. Each test pins
 * a decision that was made deliberately and would be easy to undo by accident.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { describe, expect, test } from "bun:test";

import { Denied, ErrorPage, Interstitial } from "../ui/frame";
import { AccessWall } from "../ui/wall";

const DOMAIN = "next-dashboard-store.otterstack.dev";

/** Resolve a Hono JSX element to its rendered HTML. The element type is
 *  `HtmlEscapedString | Promise<HtmlEscapedString>`, so await first (a bare
 *  `String(...)` would print `[object Promise]` for the async arm), then
 *  coerce: at runtime the resolved value is a JSXNode whose `toString()` does
 *  the actual render. */
const render = async (el: HtmlEscapedString | Promise<HtmlEscapedString>): Promise<string> =>
  String(await el);

const wall = (hasPin = false) =>
  render(
    <AccessWall domain={DOMAIN} returnPath="/" orgAuthorizeUrl="/authorize" hasPin={hasPin} />,
  );

describe("one accent", () => {
  // The wall used to set hue 300. A violet found nowhere else in the product,
  // on its most public screen. DESIGN.md mandates a single accent.
  const pages = [
    ["wall", wall()],
    ["wall (pin)", wall(true)],
    ["interstitial", render(<Interstitial next="/next" />)],
    ["400", render(<ErrorPage status={400} title="t" detail="d" />)],
    ["404", render(<ErrorPage status={404} title="t" detail="d" />)],
  ] as const;

  for (const [name, html] of pages) {
    test(`${name} carries no off-brand hue`, async () => {
      expect(await html).not.toMatch(/0\.2\d+ 300/);
    });
  }

  test("4xx uses the brand accent, 5xx uses the destructive red", async () => {
    expect(await render(<ErrorPage status={404} title="t" detail="d" />)).toContain("259.815");
    expect(await render(<ErrorPage status={500} title="t" detail="d" />)).toContain("0.205 25");
  });
});

describe("the sign-in wall", () => {
  test("names the host it is protecting", async () => {
    // The anti-phishing anchor: the one thing a visitor must read before
    // typing a credential.
    expect(await wall()).toContain("Protected site");
    expect(await wall()).toContain(`target-host">${DOMAIN}`);
  });

  test("keeps the static backdrop under the field", async () => {
    // The canvas is an enhancement; if it never runs the page must still look
    // finished rather than like a failed render.
    const html = await wall();
    expect(html).toContain('class="bg-grid"');
    expect(html).toContain('id="field"');
  });

  test("carries the generated brand mark, not a redrawn one", async () => {
    // mark-geometry.ts is generated so the app, favicons and this page can't
    // drift. A hand-drawn mark here is exactly that drift.
    expect(await wall()).toContain('rx="7.1"');
  });

  test("the footer status is driven, not decorative", async () => {
    const html = await wall();
    expect(html).toContain('id="pfStatus"');
    expect(html).toContain("step('CODE SENT')");
    expect(html).toContain("step('VERIFYING')");
  });

  test("a PIN route opens LOCKED, not AWAITING SIGN-IN", async () => {
    // No sign-in is on offer, so that status was simply wrong.
    expect(await wall(true)).toContain("step('LOCKED')");
  });

  test("renders balanced markup", async () => {
    for (const html of [await wall(), await wall(true)]) {
      const open = html.match(/<div/g)?.length ?? 0;
      const close = html.match(/<\/div>/g)?.length ?? 0;
      expect(open).toBe(close);
    }
  });
});

describe("failure pages", () => {
  test("an expired link offers the way back its copy promises", async () => {
    // The detail says "try opening the protected site again". Without this
    // there is nothing to click.
    const html = await render(
      <ErrorPage status={400} title="Link expired" detail="…" retryHost={DOMAIN} />,
    );
    expect(html).toContain(`href="https://${DOMAIN}/"`);
  });

  test("a missing deployment offers none", async () => {
    // Retrying a deployment that doesn't exist just fails again.
    expect(await render(<ErrorPage status={404} title="t" detail="d" />)).not.toContain(
      'class="retry',
    );
  });

  test("denied distinguishes not-invited from signed-out", async () => {
    // Reached only WITH a valid session; the old copy read as "you're signed
    // out" and sent people back to a sign-in they had already completed.
    expect(await render(<Denied domain={DOMAIN} />)).toContain("signed in, but not invited");
  });
});
