import { describe, expect, test, vi } from "vite-plus/test";

import type { ImagePullEvent } from "../image-pull";

import { createPullLineSummarizer } from "../pull-progress";

const event = (overrides: Partial<ImagePullEvent>): ImagePullEvent => ({
  image: "postgres:18-alpine",
  id: null,
  status: "unknown",
  progress: null,
  current: null,
  total: null,
  ...overrides,
});

describe("createPullLineSummarizer", () => {
  test("passes headline events through verbatim", () => {
    const s = createPullLineSummarizer();
    expect(s.push(event({ id: "18-alpine", status: "Pulling from library/postgres" }))).toBe(
      "Pulling from library/postgres",
    );
    expect(s.push(event({ status: "Already present" }))).toBe("Already present");
    expect(s.push(event({ status: "Status: Downloaded newer image for postgres:18-alpine" }))).toBe(
      "Status: Downloaded newer image for postgres:18-alpine",
    );
  });

  test("suppresses per-layer chatter between intervals, then emits one aggregate line", () => {
    vi.useFakeTimers();
    try {
      const s = createPullLineSummarizer(2_000);
      // First layer events land inside the initial interval — all quiet.
      expect(s.push(event({ id: "a", status: "Pulling fs layer" }))).toBeNull();
      expect(
        s.push(
          event({ id: "a", status: "Downloading", current: 1024 * 1024, total: 8 * 1024 * 1024 }),
        ),
      ).toBeNull();
      expect(
        s.push(
          event({
            id: "b",
            status: "Downloading",
            current: 2 * 1024 * 1024,
            total: 4 * 1024 * 1024,
          }),
        ),
      ).toBeNull();

      // Past the interval: one line with the cross-layer byte sums.
      vi.advanceTimersByTime(2_001);
      expect(
        s.push(
          event({
            id: "a",
            status: "Downloading",
            current: 3 * 1024 * 1024,
            total: 8 * 1024 * 1024,
          }),
        ),
      ).toBe("Pulling postgres:18-alpine: 5.0 MB of 12.0 MB");

      // Emitting resets the throttle — the very next layer event is quiet again.
      expect(
        s.push(
          event({
            id: "b",
            status: "Downloading",
            current: 3 * 1024 * 1024,
            total: 4 * 1024 * 1024,
          }),
        ),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("stays quiet when no bytes have been counted yet", () => {
    vi.useFakeTimers();
    try {
      const s = createPullLineSummarizer(2_000);
      expect(s.push(event({ id: "a", status: "Pulling fs layer" }))).toBeNull();
      vi.advanceTimersByTime(2_001);
      // Interval elapsed but zero known bytes — a "0.0 MB" line says nothing.
      expect(s.push(event({ id: "a", status: "Waiting" }))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("omits the total when docker hasn't reported layer sizes", () => {
    vi.useFakeTimers();
    try {
      const s = createPullLineSummarizer(2_000);
      s.push(event({ id: "a", status: "Downloading", current: 1024 * 1024, total: null }));
      vi.advanceTimersByTime(2_001);
      expect(s.push(event({ id: "a", status: "Downloading", current: 2 * 1024 * 1024 }))).toBe(
        "Pulling postgres:18-alpine: 2.0 MB",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
