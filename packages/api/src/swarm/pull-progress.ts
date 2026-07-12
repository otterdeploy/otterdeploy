/**
 * Condenses the firehose of docker pull events (hundreds of per-layer
 * Downloading/Extracting updates per second) into a handful of calm,
 * human-readable log lines: the headline events verbatim ("Pulling from
 * library/postgres", "Status: Downloaded newer image…") plus an aggregate
 * byte-progress line every few seconds.
 *
 * Deploy paths feed these lines into `deployment_log` so the operator can SEE
 * a long image download instead of a silent gap — and so the zero-task stale
 * check (`isBuildStillLogging`) keeps the deployment "building" while bytes
 * are still flowing instead of flipping a slow pull to "failed".
 */
import type { ImagePullEvent } from "./image-pull";

const DEFAULT_INTERVAL_MS = 2_000;

// Per-layer chatter — aggregated into the throttled byte line instead of
// logged verbatim. Anything else ("Pulling from …", "Digest: …",
// "Status: …", "Already present", registry error text) passes through.
const LAYER_NOISE =
  /^(Downloading|Extracting|Pulling fs layer|Waiting|Verifying Checksum|Download complete|Pull complete|Already exists)$/;

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export interface PullLineSummarizer {
  /** Feed one raw docker event; returns a line worth logging, or null. */
  push(event: ImagePullEvent): string | null;
}

export function createPullLineSummarizer(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): PullLineSummarizer {
  // Docker reports bytes per layer id — the cross-layer sum is what reads as
  // "one download" to the operator.
  const current = new Map<string, number>();
  const total = new Map<string, number>();
  // Start the throttle clock now — the pass-through headline ("Pulling from
  // library/postgres") already confirms the pull started, so the first byte
  // line can wait a full interval.
  let lastEmit = Date.now();

  return {
    push(event) {
      if (!LAYER_NOISE.test(event.status)) return event.status;
      if (event.id) {
        if (event.current != null) current.set(event.id, event.current);
        if (event.total != null && event.total > 0) total.set(event.id, event.total);
      }
      const now = Date.now();
      if (now - lastEmit < intervalMs) return null;
      const done = [...current.values()].reduce((a, b) => a + b, 0);
      const known = [...total.values()].reduce((a, b) => a + b, 0);
      if (done === 0 && known === 0) return null;
      lastEmit = now;
      return `Pulling ${event.image}: ${mb(done)}${known > 0 ? ` of ${mb(known)}` : ""}`;
    },
  };
}
