import { defineCommand } from "citty";
import { consola } from "consola";

import type { ResourceContext } from "../lib/resolve";

import { resolveResource } from "../lib/resolve";

// Mirrors the API's `resourceLogEventSchema` (docker task tails). Build-log
// events extend this shape with a `seq` — formatEvent handles both.
interface ResourceLogEvent {
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

// Render one log event for stdout. `--json` emits the raw event verbatim;
// otherwise prefix with a timestamp and a stream tag ([err]/[sys]).
function formatEvent(event: ResourceLogEvent, json: boolean): string {
  if (json) return `${JSON.stringify(event)}\n`;
  const tag = event.stream === "stderr" ? "[err]" : event.stream === "system" ? "[sys]" : "";
  const ts = event.ts ? `${event.ts} ` : "";
  return `${ts}${tag}${tag ? " " : ""}${event.line}\n`;
}

const SINCE_RELATIVE = /^(\d+)([smhd])$/;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Relative windows (15m, 2h, 3d) or any Date.parse-able timestamp → ISO UTC,
// which is what the server's zod schema accepts.
function parseSince(raw: string): string {
  const match = SINCE_RELATIVE.exec(raw);
  if (match) {
    const amount = Number.parseInt(match[1] ?? "", 10);
    const unitMs = UNIT_MS[match[2] ?? ""];
    if (Number.isFinite(amount) && unitMs !== undefined) {
      return new Date(Date.now() - amount * unitMs).toISOString();
    }
  }
  const parsedMs = Date.parse(raw);
  if (Number.isNaN(parsedMs)) {
    consola.error(`Invalid --since value "${raw}". Use 15m, 2h, 3d, or an ISO timestamp.`);
    process.exit(1);
  }
  return new Date(parsedMs).toISOString();
}

// How often the consume loop wakes up to re-check stop conditions while the
// iterator has no event ready.
const STOP_CHECK_MS = 200;
// --no-follow against a server that predates the `follow` input (unknown keys
// are stripped, so it keeps streaming): stop once this long passes with no
// event — the replay burst arrives with far smaller gaps. Measured BETWEEN
// events, so it never trips before the first line.
const NO_FOLLOW_IDLE_MS = 1_500;
// Safety net so --no-follow still exits if the server never yields a first
// event (it normally emits at least a system line within a second or two).
const INITIAL_CONNECT_MS = 15_000;
// Server contract caps `tail` at 1000 (resourceLogsTailInput); clamp so a
// larger --tail is honored as "the max" instead of 400-rejected.
const MAX_TAIL = 1_000;
// Once the deployment goes terminal the build-log stream never self-ends;
// keep draining this long so trailing lines flush, then stop.
const TERMINAL_GRACE_MS = 2_000;
const BUILD_POLL_INTERVAL_MS = 5_000;
// Build phase is over for all of these (matches the server's log-stream set,
// plus derived `crashed` which also implies the build completed).
const BUILD_TERMINAL_STATUSES = new Set(["running", "crashed", "failed", "superseded", "removed"]);

// Consume a log stream with external stop conditions: each pending next() is
// raced against a short tick so SIGINT / terminal-grace / idle timeouts break
// the loop even when no event ever arrives (the tails are infinite streams).
async function consumeStream<T extends ResourceLogEvent>(
  stream: AsyncIterable<T>,
  json: boolean,
  opts: { idleStopMs: number | null; shouldStop: () => boolean },
): Promise<void> {
  const iterator = stream[Symbol.asyncIterator]();
  const startedAt = Date.now();
  // Null until the first event: the idle window measures gaps BETWEEN events,
  // not the initial connect/setup latency (a slow docker ps must not look idle).
  let lastEventAt: number | null = null;
  let pending: Promise<IteratorResult<T>> | null = null;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (opts.shouldStop()) return;
      if (opts.idleStopMs !== null) {
        if (lastEventAt !== null && Date.now() - lastEventAt >= opts.idleStopMs) return;
        if (lastEventAt === null && Date.now() - startedAt >= INITIAL_CONNECT_MS) return;
      }
      pending ??= iterator.next();
      const winner = await Promise.race([
        pending.then((result) => ({ tick: false as const, result })),
        new Promise<{ tick: true }>((resolve) => {
          setTimeout(() => resolve({ tick: true }), STOP_CHECK_MS);
        }),
      ]);
      if (winner.tick) continue;
      pending = null;
      if (winner.result.done) return;
      process.stdout.write(formatEvent(winner.result.value, json));
      lastEventAt = Date.now();
    }
  } finally {
    // The abandoned next() may still reject after we leave — swallow it, and
    // close the stream so the server-side generator's finally releases the
    // docker socket.
    pending?.catch(() => undefined);
    void iterator.return?.()?.catch(() => undefined);
  }
}

// --build: stream the builder pipeline's output for one deployment. Per the
// server's semantics, a terminal deployment yields scrollback then the stream
// ENDS; a non-terminal one never self-terminates — so poll deployments.list
// and stop (after a grace window) once the deployment goes terminal.
async function runBuildLogs(
  ctx: ResourceContext,
  deploymentArg: string | undefined,
  json: boolean,
  follow: boolean,
  isStopping: () => boolean,
): Promise<void> {
  let deploymentId = deploymentArg ?? null;
  if (!deploymentId) {
    const deployments = await ctx.client.project.resource.deployments.list({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
    });
    const newest = deployments[0];
    if (!newest) {
      consola.error(`No deployments found for ${ctx.resourceName}.`);
      process.exit(1);
    }
    deploymentId = newest.id;
  }

  const stream = await ctx.client.project.resource.deployments.buildLogs.stream({ deploymentId });

  let terminalAtMs: number | null = null;
  let pollBusy = false;
  const poller = setInterval(() => {
    if (pollBusy || terminalAtMs !== null) return;
    pollBusy = true;
    ctx.client.project.resource.deployments
      .list({ projectId: ctx.projectId, resourceId: ctx.resourceId })
      .then((rows) => {
        const row = rows.find((d) => d.id === deploymentId);
        if (row && BUILD_TERMINAL_STATUSES.has(row.status)) terminalAtMs ??= Date.now();
      })
      .catch(() => undefined)
      .finally(() => {
        pollBusy = false;
      });
  }, BUILD_POLL_INTERVAL_MS);

  try {
    await consumeStream(stream, json, {
      idleStopMs: follow ? null : NO_FOLLOW_IDLE_MS,
      shouldStop: () =>
        isStopping() || (terminalAtMs !== null && Date.now() - terminalAtMs >= TERMINAL_GRACE_MS),
    });
  } finally {
    clearInterval(poller);
  }
}

export const logsCommand = defineCommand({
  meta: {
    name: "logs",
    description: "Tail logs from a service or database",
  },
  args: {
    resource: {
      type: "positional",
      required: false,
      description: "Resource name (service or database)",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    tail: { type: "string", description: "Replay this many lines first (default 100)" },
    since: {
      type: "string",
      description: "Only runtime logs newer than 15m, 2h, 3d, or an ISO timestamp",
    },
    follow: {
      type: "boolean",
      default: true,
      description: "Keep streaming (--no-follow prints available logs and exits)",
    },
    build: {
      type: "boolean",
      description: "Stream the build pipeline's logs instead of runtime logs",
    },
    deployment: {
      type: "string",
      description: "Deployment id for --build (defaults to the newest deployment)",
    },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as one JSON event per line" },
  },
  async run({ args }) {
    if (!args.resource) {
      consola.error("Pass a resource name, e.g. `otterdeploy logs web`.");
      process.exit(1);
    }
    if (args.build && args.since) {
      consola.error("--since applies only to runtime logs; drop it when using --build.");
      process.exit(1);
    }
    if (args.deployment && !args.build) {
      consola.error("--deployment only makes sense with --build.");
      process.exit(1);
    }

    const json = Boolean(args.json);
    const follow = args.follow !== false;

    // Graceful SIGINT — leave the stream's `for await` early so the
    // server-side generator's finally block releases the docker bus.
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });

    if (args.build) {
      const ctx = await resolveResource(args, args.resource, "service");
      await runBuildLogs(ctx, args.deployment, json, follow, () => stopping);
      process.exit(0);
    }

    const ctx = await resolveResource(args, args.resource);
    const since = args.since ? parseSince(args.since) : undefined;
    const parsedTail = args.tail ? Number.parseInt(args.tail, 10) : null;
    // --since without an explicit --tail: ask for the contract max so the
    // window isn't clipped by the 100-line default. An explicit --tail is
    // clamped to [0, MAX_TAIL] so a big value maps to "the max", not a 400.
    const tail =
      parsedTail !== null && Number.isFinite(parsedTail)
        ? Math.min(MAX_TAIL, Math.max(0, parsedTail))
        : since
          ? MAX_TAIL
          : 100;

    const stream = await ctx.client.project.resource.logs.tail({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      tail,
      follow,
      ...(since ? { since } : {}),
    });

    // Both paths run through consumeStream so the STOP_CHECK tick re-checks
    // `stopping` even while the stream is idle — otherwise Ctrl-C on a quiet
    // follow stream would hang until the next line arrived.
    await consumeStream(stream, json, {
      idleStopMs: follow ? null : NO_FOLLOW_IDLE_MS,
      shouldStop: () => stopping,
    });
    process.exit(0);
  },
});
