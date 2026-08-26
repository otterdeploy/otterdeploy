/* oxlint-disable max-lines-per-function, complexity, no-console, typescript/no-unsafe-return -- browser tracker: ONE self-contained function whose source text is serialized verbatim by ./index.ts (Function#toString), so it cannot be split into module-scope helpers; console is the documented `data-debug` / `#otter-ignore` surface; deliberately untyped .js (everything is `any` to the type-aware linter), the shape it returns is checked behaviourally by __tests__/tracker.test.ts. */
/**
 * otterdeploy web-analytics tracker (served at /a/otter.js).
 *
 * Plain JS on purpose: it is shipped to visitors' browsers as-is (whitespace-
 * minified by Bun.Transpiler in ./index.ts) and must run in evergreen browsers
 * plus Safari 14 (ES2020: `?.` ok, no class fields, no `||=`). Everything the
 * page exposes is reached through `w` so the test suite can run it against a
 * fake window. Wire format: docs/designs/web-analytics.md section 3.
 *
 * Entry points never throw out of the tracker: the loader wraps this call in
 * try/catch and every listener / API method goes through `safe()`. A broken
 * host page is worse than a lost event. (The TS no-try/catch rule is for TS.)
 */
export function install(w) {
  const d = w.document;
  const n = w.navigator;
  const l = w.location;
  const h = w.history;
  const con = w.console || { debug() {}, info() {} };

  // ── config from our own <script> element ───────────────────────────────
  let s = d.currentScript;
  if (!s || !s.getAttribute("data-key")) {
    s = null;
    const all = d.getElementsByTagName("script");
    for (let i = all.length - 1; i >= 0 && !s; i--) {
      if (all[i].getAttribute("data-key")) s = all[i];
    }
  }
  if (!s) return;
  const attr = (k) => s.getAttribute("data-" + k);
  const flag = (k) => attr(k) !== null && attr(k) !== "false";
  const key = attr("key");
  if (!key) return;
  const debug = flag("debug");
  const hashRouting = flag("hash-routing");
  const excludeSearch = attr("exclude-search") !== "false";
  const collector = (
    attr("collector") || (s.src ? new URL(s.src, l.href).origin : l.origin)
  ).replace(/\/+$/, "");
  const domains = (attr("domains") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const auto = attr("auto-events") === null ? "links,downloads" : attr("auto-events");
  const autoLinks = auto.indexOf("links") >= 0;
  const autoDownloads = auto.indexOf("downloads") >= 0;
  let consent = flag("require-consent") ? "pending" : "granted";

  // ── small helpers ──────────────────────────────────────────────────────
  const read = (kind, k) => {
    try {
      return w[kind].getItem(k);
    } catch {
      return null;
    }
  };
  const write = (kind, k, v) => {
    try {
      if (v === null) w[kind].removeItem(k);
      else w[kind].setItem(k, v);
    } catch {
      /* storage blocked (private mode, sandboxed iframe) */
    }
  };
  const host = (url) => {
    try {
      return new URL(url, l.href).hostname;
    } catch {
      return "";
    }
  };
  const safe =
    (fn) =>
    (...a) => {
      try {
        return fn(...a);
      } catch (e) {
        if (debug) con.debug("otter: error", e);
        return undefined;
      }
    };
  const uuid = () => {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else if (i === 19) out += (((Math.random() * 4) | 0) + 8).toString(16);
      else out += ((Math.random() * 16) | 0).toString(16);
    }
    return out;
  };
  const hostname = l.hostname;
  const sameSite = (hn) =>
    hn === hostname || hn.endsWith("." + hostname) || hostname.endsWith("." + hn);

  // ── self-exclusion + do-not-track gates ────────────────────────────────
  if (l.hash === "#otter-ignore") {
    write("localStorage", "otter_ignore", "1");
    con.info("otter: this browser is now excluded from analytics (#otter-unignore to undo)");
  } else if (l.hash === "#otter-unignore") {
    write("localStorage", "otter_ignore", null);
    con.info("otter: this browser is included in analytics again");
  }
  const gated =
    n.globalPrivacyControl === true ||
    (flag("respect-dnt") && (n.doNotTrack === "1" || w.doNotTrack === "1")) ||
    n.webdriver === true ||
    read("localStorage", "otter_ignore") === "1" ||
    (!debug && (l.protocol === "file:" || hostname === "localhost" || hostname === "127.0.0.1")) ||
    (domains.length > 0 && !domains.some((dm) => hostname === dm || hostname.endsWith("." + dm)));

  // ── session hint + transport ───────────────────────────────────────────
  let sid = read("sessionStorage", "otter_sid");
  if (!sid) {
    sid = uuid();
    write("sessionStorage", "otter_sid", sid);
  }
  let q = [];
  let held = [];
  let timer = null;
  const parked = () => {
    const raw = read("sessionStorage", "otter_q");
    write("sessionStorage", "otter_q", null);
    if (!raw) return [];
    try {
      const min = Date.now() - 864e5;
      return JSON.parse(raw).filter((e) => e && typeof e.ts === "number" && e.ts > min);
    } catch {
      return [];
    }
  };
  const park = (events) => {
    const keep = parked().concat(events).slice(-100);
    if (keep.length) write("sessionStorage", "otter_q", JSON.stringify(keep));
  };
  const send = (events, beacon) => {
    const body = JSON.stringify({ k: key, v: 1, sid, e: events });
    if (events.length > 1 && body.length > 60000) {
      const half = Math.ceil(events.length / 2);
      send(events.slice(0, half), beacon);
      send(events.slice(half), beacon);
      return;
    }
    const url = collector + "/a/c";
    if (beacon && n.sendBeacon && n.sendBeacon(url, new Blob([body], { type: "text/plain" })))
      return;
    if (!w.fetch) {
      park(events);
      return;
    }
    w.fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
    }).then(
      (r) => {
        if (r.status >= 500 || r.status === 429) park(events);
      },
      () => park(events),
    );
  };
  const flush = (beacon) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const all = parked().concat(q);
    q = [];
    for (let i = 0; i < all.length; i += 50) send(all.slice(i, i + 50), beacon);
  };
  const push = (e) => {
    if (gated || consent === "denied") return;
    if (debug) con.debug("otter:", e.t, e);
    if (consent !== "granted") {
      if (held.length < 100) held.push(e);
      return;
    }
    q.push(e);
    if (q.length >= 20) flush(false);
    else if (!timer) timer = setTimeout(() => flush(false), 1000);
  };

  // ── page url / events ──────────────────────────────────────────────────
  let cur = "";
  const pageUrl = () => {
    const u = new URL(l.href);
    if (!hashRouting) u.hash = "";
    if (excludeSearch && u.search) {
      const kept = [];
      u.searchParams.forEach((v, k) => {
        if (/^(utm_|ref$|source$)/.test(k))
          kept.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      });
      u.search = kept.length ? "?" + kept.join("&") : "";
    }
    return u.href;
  };
  const base = (t) => ({ id: uuid(), t, ts: Date.now(), u: cur });
  const clean = (props) => {
    const out = {};
    if (!props || typeof props !== "object" || Array.isArray(props)) return out;
    let count = 0;
    for (const k of Object.keys(props)) {
      if (count >= 32) break;
      const v = props[k];
      if (typeof v === "string") out[k] = v.slice(0, 256);
      else if ((typeof v === "number" && isFinite(v)) || typeof v === "boolean") out[k] = v;
      else continue;
      count++;
    }
    return out;
  };
  const track = (name, props) => {
    if (typeof name !== "string" || !name.length || name.length > 64) return;
    const e = base("ev");
    e.n = name;
    e.p = clean(props);
    push(e);
  };

  // ── engagement: active / visible ms + max scroll depth ─────────────────
  const visible = () => d.visibilityState !== "hidden";
  let active = 0,
    vis = 0,
    sc = 0,
    actStart = 0,
    actTimer = null,
    visStart = visible() ? Date.now() : 0;
  const endActive = () => {
    if (actStart) {
      active += Date.now() - actStart;
      actStart = 0;
    }
  };
  const onAct = () => {
    if (!visible()) return;
    if (!actStart) actStart = Date.now();
    clearTimeout(actTimer);
    actTimer = setTimeout(endActive, 5000);
  };
  const measure = () => {
    const de = d.documentElement || {};
    const top = w.scrollY || de.scrollTop || 0;
    const hgt = de.scrollHeight || 0;
    if (hgt)
      sc = Math.max(sc, Math.min(100, Math.round(((top + (w.innerHeight || 0)) / hgt) * 100)));
  };
  const engagement = () => {
    const now = Date.now();
    if (visStart) {
      vis += now - visStart;
      visStart = visible() ? now : 0;
    }
    if (actStart) {
      active += now - actStart;
      actStart = visible() ? now : 0;
    }
    if (active > 0 || sc > 0) {
      const e = base("eng");
      e.a = active;
      e.vis = vis;
      e.sc = sc;
      push(e);
    }
    active = vis = sc = 0;
  };

  // ── pageviews ──────────────────────────────────────────────────────────
  let first = true;
  const pageview = (force) => {
    const u = pageUrl();
    if (!force && u === cur) return;
    if (cur) engagement();
    cur = u;
    measure();
    const e = base("pv");
    const r = first ? d.referrer || "" : "";
    first = false;
    if (r && !sameSite(host(r))) e.r = r;
    if (d.title) e.ti = String(d.title).slice(0, 200);
    e.sw = w.innerWidth || 0;
    if (n.language) e.l = n.language;
    push(e);
  };
  let navTimer = null;
  const onNav = () => {
    // Deferred one tick so routers that set document.title after pushState
    // are captured, and so a burst of redirects yields one pageview.
    if (!navTimer)
      navTimer = setTimeout(
        safe(() => {
          navTimer = null;
          pageview(false);
        }),
        0,
      );
  };

  // ── auto events ────────────────────────────────────────────────────────
  const DL =
    /\.(pdf|zip|gz|tar|rar|7z|dmg|exe|msi|pkg|deb|rpm|apk|csv|xlsx?|docx?|pptx?|mp[34]|mov|avi|wav|txt|json|xml)$/i;
  const onClick = (ev) => {
    if (ev.type === "auxclick" && ev.button !== 1) return;
    let el = ev.target;
    if (el && !el.closest) el = el.parentElement;
    if (!el || !el.closest) return;
    const tagged = el.closest("[data-otter-event]");
    if (tagged) {
      const p = {};
      for (const a of tagged.attributes) {
        if (a.name.indexOf("data-otter-prop-") === 0) p[a.name.slice(16)] = a.value;
      }
      track(tagged.getAttribute("data-otter-event"), p);
    }
    const a = el.closest("a[href]");
    const hn = a ? host(a.href) : "";
    if (!hn) return;
    if (autoLinks && !sameSite(hn)) track("Outbound Link: Click", { url: a.href });
    else if (autoDownloads && DL.test(new URL(a.href, l.href).pathname))
      track("File Download", { url: a.href });
  };

  // ── public API (always defined, inert when gated) ──────────────────────
  const pre = w.otter && w.otter.q;
  const api = {
    track: safe(track),
    pageview: safe(() => pageview(true)),
    identify: safe((id) => {
      if (typeof id === "string" && id && id.length <= 256)
        push({ id: uuid(), t: "id", ts: Date.now(), uid: id });
    }),
    consent: safe((state) => {
      if (state === "granted") {
        consent = "granted";
        const hd = held;
        held = [];
        hd.forEach(push);
      } else if (state === "denied") {
        consent = "denied";
        held = [];
        q = [];
        write("sessionStorage", "otter_q", null);
      }
    }),
    flush: safe(() => flush(false)),
  };
  w.otter = api;
  if (gated) return;

  // ── wire up ────────────────────────────────────────────────────────────
  const passive = { passive: true, capture: true };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((t) =>
    w.addEventListener(t, safe(onAct), passive),
  );
  w.addEventListener("scroll", safe(measure), passive);
  d.addEventListener(
    "visibilitychange",
    safe(() => {
      if (visible()) {
        visStart = Date.now();
        return;
      }
      engagement();
      flush(true);
    }),
  );
  w.addEventListener(
    "pagehide",
    safe(() => {
      engagement();
      flush(true);
    }),
  );
  ["pushState", "replaceState"].forEach((m) => {
    const orig = h && h[m];
    if (!orig) return;
    h[m] = function (...args) {
      const r = orig.apply(this, args);
      onNav();
      return r;
    };
  });
  w.addEventListener("popstate", safe(onNav));
  if (hashRouting) w.addEventListener("hashchange", safe(onNav));
  if (autoLinks || autoDownloads) {
    d.addEventListener("click", safe(onClick), true);
    d.addEventListener("auxclick", safe(onClick), true);
  }
  setInterval(
    safe(() => {
      if (visible()) push(base("hb"));
    }),
    30000,
  );
  pageview(true);
  if (Array.isArray(pre)) {
    pre.forEach((call) => {
      const args = Array.prototype.slice.call(call);
      const fn = api[args.shift()];
      if (fn) fn(...args);
    });
  }
}
