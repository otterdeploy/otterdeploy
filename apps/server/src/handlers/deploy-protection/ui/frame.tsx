/**
 * Wall page chrome — the shared Hono JSX document shell plus the console-frame
 * status pages (Interstitial, Denied, ErrorPage). Split out of
 * deploy-protection.tsx to keep each module under the line cap. Public surface
 * unchanged: these components are imported back by the handler modules.
 */

import type { FC, PropsWithChildren } from "hono/jsx";

import { raw } from "hono/html";

import { consoleFrameCss } from "./css/frame";
import { deniedCss, errorPageExtraCss, interstitialExtraCss } from "./css/page";

/** Shared document shell: a black, centered, full-height page with the
 *  branded footer. `css`/`headExtra` are page-specific; Hono JSX won't add a
 *  doctype, so we prepend one raw. */
export const Page: FC<
  PropsWithChildren<{
    title: string;
    css: string;
    headExtra?: unknown;
    /** Suppress the default "Otterdeploy Authentication" footer — for pages
     *  (e.g. ErrorPage) that render their own. */
    hideFoot?: boolean;
  }>
> = ({ title, css, headExtra, hideFoot, children }) => (
  <>
    {raw("<!doctype html>")}
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {headExtra}
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {children}
        {hideFoot ? undefined : <div class="foot">Otterdeploy Authentication</div>}
      </body>
    </html>
  </>
);

/** The shared frame chrome: background layers, corner ticks, and the top/bottom
 *  status bars. `barRight` fills the top-right slot (e.g. "ERR / 500",
 *  "AUTH / SSO"); `statusTag` is the accent word in the footer STATUS line.
 *  Children render inside the centered <main> panel. */
const ConsoleFrame: FC<PropsWithChildren<{ barRight: unknown; statusTag: string }>> = ({
  barRight,
  statusTag,
  children,
}) => (
  <>
    <div class="layer grid" aria-hidden="true" />
    <div class="layer glow" aria-hidden="true" />
    <div class="layer grain" aria-hidden="true" />
    <span class="tick tl" aria-hidden="true" />
    <span class="tick tr" aria-hidden="true" />
    <span class="tick bl" aria-hidden="true" />
    <span class="tick br" aria-hidden="true" />

    <div class="bar top">
      <span>
        <span class="accent">◆</span> OTTERDEPLOY
      </span>
      <span>{barRight}</span>
    </div>

    <main>
      <div class="panel">{children}</div>
    </main>

    <div class="bar bottom">
      <span>
        STATUS: <span class="accent">{statusTag}</span>
      </span>
      <span>OTTERDEPLOY PLATFORM</span>
    </div>
  </>
);

/** The "Authenticating…" handoff screen — the shared console frame with a
 *  spinner, an indigo accent, and a live status line. Navigates to `next`
 *  immediately (meta-refresh + location.replace + noscript fallback); with no
 *  `next` (dev preview) it stays put and cycles the status steps. */
export const Interstitial: FC<{ next?: string }> = ({ next }) => (
  <Page
    title="Otterdeploy — Authenticating"
    hideFoot
    headExtra={next ? <meta http-equiv="refresh" content={`0;url=${next}`} /> : undefined}
    css={
      consoleFrameCss("oklch(0.7 0.18 300)", "oklch(0.7 0.18 300 / 0.26)") + interstitialExtraCss
    }
  >
    <ConsoleFrame
      barRight={
        <>
          AUTH / <b>SSO</b>
        </>
      }
      statusTag="VERIFYING"
    >
      <div class="eyebrow rise" style="animation-delay:0.1s">
        Authenticating
      </div>
      <div class="spinner rise" style="animation-delay:0.19s">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 2v4" />
          <path d="m16.2 7.8 2.9-2.9" />
          <path d="M18 12h4" />
          <path d="m16.2 16.2 2.9 2.9" />
          <path d="M12 18v4" />
          <path d="m4.9 19.1 2.9-2.9" />
          <path d="M2 12h4" />
          <path d="m4.9 4.9 2.9 2.9" />
        </svg>
      </div>
      <h1 class="rise" style="animation-delay:0.28s">
        Securing your session
      </h1>
      <p class="statusline rise" style="animation-delay:0.37s" id="authLabel">
        verifying identity
        <span class="cursor" />
      </p>
    </ConsoleFrame>

    {next ? (
      <>
        <noscript>
          <a href={next} style="color:var(--ink)">
            Continue
          </a>
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `location.replace(${JSON.stringify(next)})`,
          }}
        />
      </>
    ) : (
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var s=["verifying identity","fetching workspace","checking permissions","loading environment"],i=0,el=document.getElementById("authLabel");setInterval(function(){i=(i+1)%s.length;el.innerHTML=s[i]+'<span class="cursor"></span>';},2400);})();`,
        }}
      />
    )}
  </Page>
);

export const Denied: FC<{ domain: string }> = ({ domain }) => (
  <Page title="No access" css={deniedCss}>
    <div class="wrap">
      <h1>You don't have access</h1>
      <p>
        This deployment ({domain}) is protected. Ask an organization owner to add you, or switch to
        an account that's a member.
      </p>
    </div>
  </Page>
);

/** Branded failure page for the wall routes — bad/expired link, unknown
 *  deployment, or an unexpected 500. Uses the shared console frame (same
 *  grid/glow/grain + corner-tick chrome as the web `ErrorScreen`). `title`/
 *  `detail` are fixed, caller-chosen copy: no error object, stack, or SQL ever
 *  reaches the page. */
export const ErrorPage: FC<{ status: number; title: string; detail: string }> = ({
  status,
  title,
  detail,
}) => {
  // 5xx = red (our fault), 4xx = indigo (request/link) — mirrors the web pages.
  const isServer = status >= 500;
  const accent = isServer ? "oklch(0.685 0.205 25)" : "oklch(0.7 0.17 264)";
  const glow = isServer ? "oklch(0.685 0.205 25 / 0.26)" : "oklch(0.7 0.17 264 / 0.26)";
  const eyebrow = isServer ? "Internal error" : "Request blocked";
  const statusTag = isServer ? "FAULT" : "BLOCKED";

  return (
    <Page title={title} hideFoot css={consoleFrameCss(accent, glow) + errorPageExtraCss}>
      <ConsoleFrame
        barRight={
          <>
            ERR / <b>{String(status)}</b>
          </>
        }
        statusTag={statusTag}
      >
        <div class="eyebrow rise" style="animation-delay:0.1s">
          {eyebrow}
        </div>
        <div class="numeral rise" style="animation-delay:0.19s">
          {String(status)}
        </div>
        <h1 class="rise" style="animation-delay:0.28s">
          {title}
        </h1>
        <p class="msg rise" style="animation-delay:0.37s">
          {detail}
        </p>
      </ConsoleFrame>
    </Page>
  );
};
