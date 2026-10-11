import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { enrollmentSteps } from "../components/enrollment-progress";
import { clockSpan } from "./install-step";
import { InstallSteps, Outcome } from "./install-steps";

const installing = enrollmentSteps({
  id: "nen_1",
  role: "worker",
  status: "redeemed",
  createdAt: "2026-10-11T12:00:00.000Z",
  expiresAt: "2026-10-11T12:10:00.000Z",
  redeemedAt: "2026-10-11T12:00:06.000Z",
  completedAt: null,
});

describe("InstallSteps", () => {
  const html = renderToStaticMarkup(<InstallSteps steps={installing} />);

  it("renders each step in its own state", () => {
    const states = [...html.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
    expect(states).toEqual(["done", "done", "active", "pending"]);
  });

  it("says each state in words, not only with an icon", () => {
    expect(html).toContain('Server ran it<span class="sr-only">, done</span>');
    expect(html).toContain('Joining<span class="sr-only">, in progress</span>');
    expect(html).toContain('Connected<span class="sr-only">, not started</span>');
  });

  it("shows a time only for steps that have finished", () => {
    expect(html).toContain("0:06");
    expect(html.match(/<span class="sr-only">at <\/span>/g)?.length).toBe(2);
  });
});

describe("Outcome", () => {
  it("announces a failure", () => {
    const html = renderToStaticMarkup(
      <Outcome tone="err" title="Docker didn't install on 203.0.113.24">
        apt exited 100
      </Outcome>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("text-destructive");
  });

  it("reports success and expiry as status", () => {
    for (const tone of ["ok", "muted"] as const) {
      const html = renderToStaticMarkup(
        <Outcome tone={tone} title="t">
          s
        </Outcome>,
      );
      expect(html).toContain('role="status"');
    }
  });
});

describe("clockSpan", () => {
  it("reads as m:ss and never goes negative", () => {
    expect(clockSpan(134_000)).toBe("2:14");
    expect(clockSpan(6_000)).toBe("0:06");
    expect(clockSpan(-5_000)).toBe("0:00");
  });
});
