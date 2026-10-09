/**
 * One install, three clocks. The Edge tables printed UTC while the
 * project Logs and Metrics printed local time and Analytics named the browser's
 * zone, so one 502 read as 04:48 on one page and 06:48 on the next.
 *
 * Every clock now reads in the viewer's zone, names that zone once on the
 * column, and keeps the UTC instant on hover. The zone is pinned for this
 * file (a half-hour offset, so a UTC clock cannot pass for a local one by
 * accident) before anything reads it.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  // oxlint-disable-next-line node/no-process-env -- test seam: the viewer's zone
  process.env.TZ = "Asia/Kolkata";
});

const { CLOCK_DAY, CLOCK_SECONDS, VIEW_ZONE, utcIso, zoneAbbreviation, zonedFormatter } =
  await import("@/shared/lib/clock");
const { ClockCell } = await import("./cells");

/** 2026-10-08 04:48:16 UTC = 10:18:16 in Kolkata. */
const AT = Date.UTC(2026, 9, 8, 4, 48, 16, 250);

describe("the app's one clock", () => {
  it("is the viewer's zone, not UTC", () => {
    // ICU may report the zone under its older alias.
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(VIEW_ZONE);
  });

  it("prints a table clock in the viewer's zone", () => {
    const html = renderToStaticMarkup(<ClockCell value={AT} />);
    const local = zonedFormatter({ ...CLOCK_DAY, ...CLOCK_SECONDS }, "Asia/Kolkata")(AT);
    expect(local).toContain("10:18:16");
    expect(html).toContain(`>${local}</time>`);
    expect(html).not.toContain(">Oct 8, 04:48:16<");
  });

  it("keeps the UTC instant one hover away", () => {
    const html = renderToStaticMarkup(<ClockCell value={AT} />);
    expect(utcIso(AT)).toBe("2026-10-08T04:48:16.250Z");
    expect(html).toContain("2026-10-08T04:48:16.250Z");
  });

  it("names the zone by its short name at the instant", () => {
    expect(zoneAbbreviation("Asia/Kolkata", AT)).toMatch(/GMT\+5:30|IST/);
    expect(zoneAbbreviation("UTC", AT)).toBe("UTC");
    // Berlin's name moves with daylight saving: summer and winter differ.
    const summer = zoneAbbreviation("Europe/Berlin", Date.UTC(2026, 6, 1));
    const winter = zoneAbbreviation("Europe/Berlin", Date.UTC(2026, 0, 1));
    expect(summer).not.toBe(winter);
  });
});
