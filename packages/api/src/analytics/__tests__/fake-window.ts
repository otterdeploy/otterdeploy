/**
 * Minimal window/document/navigator graph for exercising the served tracker
 * script without jsdom. Only what otter.js touches is modelled; listeners are
 * recorded so a test can `fire()` them, and every outbound request is captured.
 */
import * as z from "zod";

type Listener = (event: Record<string, unknown>) => void;

const payloadSchema = z.object({
  k: z.string(),
  v: z.number(),
  sid: z.string(),
  e: z.array(z.record(z.string(), z.unknown())),
});
export type Payload = z.infer<typeof payloadSchema>;

export interface Request {
  url: string;
  via: "fetch" | "beacon";
  contentType: string | undefined;
  payload: Payload;
}

export interface FakeWindowOptions {
  href?: string;
  attrs?: Record<string, string>;
  referrer?: string;
  gpc?: boolean;
  fetchStatus?: number;
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

function locationFrom(href: string): Record<string, string> {
  const u = new URL(href);
  return {
    href: u.href,
    origin: u.origin,
    protocol: u.protocol,
    hostname: u.hostname,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
  };
}

export function makeFakeWindow(options: FakeWindowOptions = {}) {
  const listeners = new Map<string, Listener[]>();
  const on = (name: string, fn: Listener): void => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  };
  const requests: Request[] = [];
  const attrs: Record<string, string> = { key: "od_test", ...options.attrs };
  const script = {
    src: "https://cp.example/a/otter.js",
    getAttribute: (name: string): string | null => attrs[name.replace(/^data-/, "")] ?? null,
  };
  const location = locationFrom(options.href ?? "https://site.example/pricing?utm_source=x&id=7");
  const navigate = (url: string): void => {
    Object.assign(location, locationFrom(new URL(url, location.href).href));
  };
  const record = (via: Request["via"], url: string, body: string, contentType?: string): void => {
    requests.push({ url, via, contentType, payload: payloadSchema.parse(JSON.parse(body)) });
  };
  const document = {
    currentScript: script,
    getElementsByTagName: () => [script],
    referrer: options.referrer ?? "https://google.com/",
    title: "Pricing",
    visibilityState: "visible",
    documentElement: { scrollHeight: 2000, scrollTop: 0 },
    addEventListener: on,
  };
  const w = {
    document,
    navigator: {
      language: "en-GB",
      webdriver: false,
      globalPrivacyControl: options.gpc ?? false,
      sendBeacon: (url: string, blob: Blob): boolean => {
        void blob.text().then((text) => record("beacon", url, text, blob.type));
        return true;
      },
    },
    location,
    history: {
      pushState: (_s: unknown, _t: string, url: string) => navigate(url),
      replaceState: (_s: unknown, _t: string, url: string) => navigate(url),
    },
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    fetch: (url: string, init: { body: string; headers: Record<string, string> }) => {
      record("fetch", url, init.body, init.headers["Content-Type"]);
      return Promise.resolve(new Response(null, { status: options.fetchStatus ?? 204 }));
    },
    innerWidth: 1440,
    innerHeight: 800,
    scrollY: 0,
    addEventListener: on,
    console: { debug: () => {}, info: () => {} },
    otter: undefined,
  };
  const fire = (name: string, event: Record<string, unknown> = {}): void => {
    for (const fn of listeners.get(name) ?? []) fn({ type: name, ...event });
  };
  return { w, requests, fire, navigate, listeners };
}

export type FakeWindow = ReturnType<typeof makeFakeWindow>;

const fn = z.custom<(...args: unknown[]) => unknown>((value) => typeof value === "function");
const apiSchema = z.object({
  track: fn,
  pageview: fn,
  identify: fn,
  consent: fn,
  flush: fn,
});

/** The `window.otter` API the script installed, parsed rather than asserted. */
export function otterApi(fake: FakeWindow) {
  return apiSchema.parse(fake.w.otter);
}
