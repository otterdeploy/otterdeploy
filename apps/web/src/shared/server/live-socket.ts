/**
 * The live socket: one WebSocket per tab for every long-lived stream.
 *
 * Why: a tab used to hold one HTTP request open per live stream (org events,
 * project events, each log tail). Over plain HTTP/1.1, the installer's
 * `http://IP:3000` before a domain is set, Chrome gives a host six connections
 * shared by every tab, so two dashboard tabs left nothing for ordinary calls:
 * panels sat on "Loading…" and an Apply click never reached the server. Here
 * every stream the tab opens shares this one socket (oRPC's peer protocol
 * multiplexes them: subscribe is a request message, unsubscribe an abort), and
 * a WebSocket is outside the per-host HTTP pool altogether.
 *
 * What runs here is a `StandardLinkClient`: the oRPC link builds the same
 * request it always did and this decides how it travels.
 *
 *   - Not a live subscription (see @otterdeploy/api/routers/live-socket):
 *     plain HTTP, untouched.
 *   - A live subscription: over the socket, opened on first use.
 *   - The socket cannot be opened (a proxy that refuses the upgrade): plain
 *     HTTP for that call, and the socket is not retried for a while. Degraded
 *     to the old budget, never broken.
 *
 * A hidden tab releases its socket after `releaseAfterMs`, which ends every
 * stream on it server-side (Redis subscribers, docker log attachments). New
 * calls then wait for the tab to be shown again, and the callers' own
 * reconnects resubscribe (event streams resync what they missed; see
 * `onReconnected` in use-org-events / use-project-events). `released` tells a
 * caller that a stream ended because of this, not because something broke.
 */
import type { ClientContext, ClientOptions } from "@orpc/client";
import type { StandardLinkClient } from "@orpc/client/standard";

import { LinkWebsocketClient } from "@orpc/client/websocket";
import { isLiveSocketProcedure } from "@otterdeploy/api/routers/live-socket";
import { Temporal } from "@otterdeploy/shared/temporal";
import { TaggedError } from "better-result";

/** The parts of a browser WebSocket this uses. */
export type LiveWebSocket = Pick<
  WebSocket,
  "readyState" | "addEventListener" | "removeEventListener" | "send" | "close"
>;

/** Page visibility, abstracted so the policy can be driven in a test. */
export interface VisibilitySource {
  hidden(): boolean;
  subscribe(onChange: () => void): () => void;
}

export interface LiveSocketOptions<T extends ClientContext> {
  /** `ws(s)://…/live/rpc`. */
  url: string;
  /** Where everything that is not a live subscription goes. */
  http: StandardLinkClient<T>;
  createSocket(url: string): LiveWebSocket;
  visibility: VisibilitySource;
  /** How long a tab stays hidden before its socket is released. Long enough
   *  that flicking between tabs does not churn every stream. */
  releaseAfterMs?: number;
  /** After the socket fails to open, how long to use HTTP before trying again. */
  retrySocketAfterMs?: number;
  /** A socket that has neither opened nor failed by now is given up on. */
  openTimeoutMs?: number;
  now?: () => number;
}

export interface LiveSocket<T extends ClientContext> extends StandardLinkClient<T> {
  /** True while a hidden tab has released its socket. A stream that ended
   *  meanwhile ended for that reason; it resumes when the tab is shown. */
  readonly released: boolean;
  /** Sockets opened so far, for tests and diagnostics. */
  readonly socketsOpened: number;
  dispose(): void;
}

const OPEN = 1;
const UNAUTHORIZED = 401;

/** The live socket could not be (re)opened. Thrown like a dropped connection,
 *  so the caller's reconnect handles it. */
export class LiveSocketUnavailableError extends TaggedError("LiveSocketUnavailableError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "The live connection to the control plane could not be opened." });
  }
}

interface Connection<T extends ClientContext> {
  socket: LiveWebSocket;
  client: LinkWebsocketClient<T>;
  /** Resolves with the connection once open, or null if it never opened. */
  ready: Promise<Connection<T> | null>;
}

type CallArgs<T extends ClientContext> = Parameters<StandardLinkClient<T>["call"]>;
type CallResult<T extends ClientContext> = ReturnType<StandardLinkClient<T>["call"]>;

class LiveSocketClient<T extends ClientContext> implements LiveSocket<T> {
  readonly #options: LiveSocketOptions<T>;
  readonly #releaseAfterMs: number;
  readonly #retrySocketAfterMs: number;
  readonly #openTimeoutMs: number;
  readonly #now: () => number;
  readonly #unsubscribeVisibility: () => void;

  #connection: Connection<T> | null = null;
  #socketBlockedUntil = 0;
  #released = false;
  #releaseTimer: ReturnType<typeof setTimeout> | null = null;
  #waitingForVisible = new Set<() => void>();
  #socketsOpened = 0;
  #everOpened = false;

  constructor(options: LiveSocketOptions<T>) {
    this.#options = options;
    this.#releaseAfterMs = options.releaseAfterMs ?? 15_000;
    this.#retrySocketAfterMs = options.retrySocketAfterMs ?? 30_000;
    this.#openTimeoutMs = options.openTimeoutMs ?? 10_000;
    this.#now = options.now ?? (() => Temporal.Now.instant().epochMilliseconds);
    this.#unsubscribeVisibility = options.visibility.subscribe(() => this.#onVisibilityChange());
    if (options.visibility.hidden()) this.#onVisibilityChange();
  }

  get released(): boolean {
    return this.#released;
  }

  get socketsOpened(): number {
    return this.#socketsOpened;
  }

  async call(...args: CallArgs<T>): CallResult<T> {
    const [request, options, path, input] = args;
    if (!isLiveSocketProcedure(path)) return this.#options.http.call(request, options, path, input);

    const connection = await this.#connect(options);
    if (!connection) return this.#options.http.call(request, options, path, input);

    const response = await connection.client.call(request, options, path, input);
    if (response.status !== UNAUTHORIZED) return response;

    // The socket authenticates with the cookies it was opened with. After a
    // sign-out and sign-in those are someone else's (or nobody's), so one
    // UNAUTHORIZED earns a fresh socket, and only a second one is believed.
    this.#drop(connection);
    const fresh = await this.#connect(options);
    if (!fresh) return this.#options.http.call(request, options, path, input);
    return fresh.client.call(request, options, path, input);
  }

  dispose(): void {
    this.#unsubscribeVisibility();
    if (this.#releaseTimer) clearTimeout(this.#releaseTimer);
    if (this.#connection) this.#drop(this.#connection);
  }

  /** An open socket for this call, or null when it should use HTTP.
   *
   *  A socket closed by a release is not a reason to fall back: the call
   *  waits for the tab to be shown and tries again. Nor is a socket that
   *  fails to open once one has opened before: the upgrade evidently works
   *  here, so the control plane is restarting, and moving the stream to HTTP
   *  would park it there, holding a connection, long after the server is
   *  back. That failure is thrown, and the caller's reconnect retries it the
   *  way it retries any dropped stream. */
  async #connect(options: ClientOptions<T>): Promise<Connection<T> | null> {
    for (;;) {
      await this.#untilShown(options);
      const connection = await this.#acquire();
      if (connection) return connection;
      if (this.#released) continue;
      if (this.#everOpened) throw new LiveSocketUnavailableError();
      return null;
    }
  }

  /** Park a call while the tab is hidden and its socket released. */
  #untilShown(options: ClientOptions<T>): Promise<void> {
    if (!this.#released) return Promise.resolve();
    const signal = options.signal;
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.#waitingForVisible.delete(onShown);
        reject(signal?.reason);
      };
      const onShown = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waitingForVisible.add(onShown);
    });
  }

  async #acquire(): Promise<Connection<T> | null> {
    if (!this.#everOpened && this.#now() < this.#socketBlockedUntil) return null;
    this.#connection ??= this.#open();
    return this.#connection.ready;
  }

  #open(): Connection<T> {
    const socket = this.#options.createSocket(this.#options.url);
    this.#socketsOpened++;
    const client = new LinkWebsocketClient<T>({ websocket: socket });
    const connection: Connection<T> = { socket, client, ready: Promise.resolve(null) };

    connection.ready = new Promise<Connection<T> | null>((resolve) => {
      const timeout = setTimeout(() => fail(), this.#openTimeoutMs);
      const settle = () => {
        clearTimeout(timeout);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
      };
      const opened = () => {
        settle();
        this.#everOpened = true;
        resolve(connection);
      };
      function fail() {
        settle();
        resolve(null);
      }
      if (socket.readyState === OPEN) {
        opened();
        return;
      }
      socket.addEventListener("open", opened);
      socket.addEventListener("error", fail);
      socket.addEventListener("close", fail);
    }).then((opened) => {
      if (opened) return opened;
      // Never opened. Unless that was a release closing it on purpose, or a
      // restart of a server whose upgrade has worked before, the upgrade is
      // being refused (a proxy without WebSocket support): use HTTP for now.
      if (!this.#released && !this.#everOpened) {
        this.#socketBlockedUntil = this.#now() + this.#retrySocketAfterMs;
      }
      this.#drop(connection);
      return null;
    });

    socket.addEventListener("close", () => {
      if (this.#connection === connection) this.#connection = null;
    });
    return connection;
  }

  #drop(connection: Connection<T>): void {
    if (this.#connection === connection) this.#connection = null;
    connection.socket.close(1000);
  }

  #onVisibilityChange(): void {
    if (this.#options.visibility.hidden()) {
      this.#releaseTimer ??= setTimeout(() => this.#release(), this.#releaseAfterMs);
      return;
    }
    if (this.#releaseTimer) {
      clearTimeout(this.#releaseTimer);
      this.#releaseTimer = null;
    }
    if (!this.#released) return;
    this.#released = false;
    const waiting = [...this.#waitingForVisible];
    this.#waitingForVisible.clear();
    for (const resume of waiting) resume();
  }

  #release(): void {
    this.#releaseTimer = null;
    this.#released = true;
    if (this.#connection) this.#drop(this.#connection);
  }
}

export function createLiveSocket<T extends ClientContext>(
  options: LiveSocketOptions<T>,
): LiveSocket<T> {
  return new LiveSocketClient(options);
}

/** The document's visibility, for the browser. */
export function documentVisibility(): VisibilitySource {
  return {
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    subscribe(onChange) {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
  };
}

/** `http(s)://host` → `ws(s)://host/live/rpc`. */
export function liveSocketUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/^http/, "ws")}${path}`;
}
