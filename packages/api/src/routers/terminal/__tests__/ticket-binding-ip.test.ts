/**
 * Regression cover for the terminal `ip_mismatch` outage.
 *
 * The bug was never in the comparison. It was that mint and consume each
 * derived "the client address" from `x-forwarded-for`, a header whose value
 * legitimately differs between a short POST and a long-lived connection when an
 * edge sits in front. The header shapes below are copied verbatim from the
 * deployment's Caddy access log: ordinary requests carried the browser address
 * in XFF, long-lived streams carried the Cloudflare edge's, and
 * `cf-connecting-ip` stayed pinned to the browser throughout.
 */
import { describe, expect, it } from "vite-plus/test";

import { ticketBindingIp } from "../tickets";

const BROWSER = "79.140.180.144";
const CF_EDGE = "104.23.166.109";

const headers = (init: Record<string, string>) => new Headers(init);

describe("ticketBindingIp", () => {
  it("binds the browser address on an ordinary proxied request", () => {
    // The `terminal.mintTicket` POST, as Caddy forwards it.
    expect(
      ticketBindingIp(headers({ "x-forwarded-for": BROWSER, "cf-connecting-ip": BROWSER })),
    ).toBe(BROWSER);
  });

  it("binds the same address on a long-lived upgrade whose XFF names the edge", () => {
    // The `/pty` upgrade. XFF disagrees with the mint request; cf-connecting-ip
    // does not. Reading XFF here is what produced ip_mismatch on every terminal.
    expect(
      ticketBindingIp(headers({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": BROWSER })),
    ).toBe(BROWSER);
  });

  it("agrees across the mint/consume pair that used to mismatch", () => {
    const mint = ticketBindingIp(
      headers({ "x-forwarded-for": BROWSER, "cf-connecting-ip": BROWSER }),
    );
    const consume = ticketBindingIp(
      headers({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": BROWSER }),
    );
    expect(consume).toBe(mint);
  });

  it("falls back to the first X-Forwarded-For hop with no edge header", () => {
    // A plain Caddy-only deployment: no cf-connecting-ip, XFF is stable.
    expect(ticketBindingIp(headers({ "x-forwarded-for": `${BROWSER}, 10.0.1.5` }))).toBe(BROWSER);
  });

  it("prefers x-real-ip over X-Forwarded-For", () => {
    expect(ticketBindingIp(headers({ "x-real-ip": BROWSER, "x-forwarded-for": CF_EDGE }))).toBe(
      BROWSER,
    );
  });

  it("returns null when nothing resolves, so binding is skipped rather than compared", () => {
    // consumeTerminalTicket only enforces when BOTH ends produced an address.
    // Null must mean "unresolved", never a sentinel string that compares unequal.
    expect(ticketBindingIp(headers({}))).toBeNull();
    expect(ticketBindingIp(headers({ "x-forwarded-for": "  " }))).toBeNull();
  });
});
