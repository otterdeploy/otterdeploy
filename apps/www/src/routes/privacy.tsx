import { createFileRoute } from "@tanstack/react-router";

import { GITHUB_URL } from "@/components/landing/content";
import { SiteBar } from "@/components/site-bar";
import { canonical, seo } from "@/lib/seo";

const description =
  "How the otterdeploy website and download edge handle browser preferences, documentation searches, request data, and optional install counts.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: seo({
      title: "Privacy and data handling",
      description,
      path: "/privacy",
      type: "article",
    }),
    links: [canonical("/privacy")],
  }),
  component: PrivacyPage,
});

const linkClass =
  "rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8 sm:py-20">
        <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
          Website policy
        </p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-[-0.025em] text-balance sm:text-5xl">
          Privacy and data handling
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
          This page describes the public website at otterdeploy.com and its download edge at
          get.otterdeploy.com. It does not cover an otterdeploy installation run by you or another
          operator; that installation's data handling depends on its servers, configuration and
          connected services.
        </p>

        <div className="mt-12 space-y-10 text-[0.9375rem] leading-7 text-muted-foreground">
          <section aria-labelledby="site-collection">
            <h2 id="site-collection" className="text-xl font-semibold text-foreground">
              What this site collects
            </h2>
            <p className="mt-3">
              The website code does not include an advertising tracker or website analytics SDK, and
              the site has no account signup, payment form or contact form. It is served through
              Cloudflare Workers, so Cloudflare receives ordinary request information needed to
              deliver and protect HTTP traffic, such as an IP address, requested URL, user agent and
              time. Cloudflare describes its handling in its{" "}
              <a
                href="https://www.cloudflare.com/privacypolicy/"
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                privacy policy
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="browser-storage">
            <h2 id="browser-storage" className="text-xl font-semibold text-foreground">
              Browser preferences
            </h2>
            <p className="mt-3">The site code uses local browser storage for two preferences:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <code>theme</code> remembers the light or dark appearance.
              </li>
              <li>
                <code>otterdeploy-docs-pm</code> remembers the package manager selected in install
                examples.
              </li>
            </ul>
            <p className="mt-3">
              Those controls do not send the stored values to otterdeploy. Clearing this site's data
              in your browser removes them.
            </p>
          </section>

          <section aria-labelledby="docs-search">
            <h2 id="docs-search" className="text-xl font-semibold text-foreground">
              Documentation search
            </h2>
            <p className="mt-3">
              A documentation search sends the query to the same-origin <code>/api/search</code>
              endpoint so it can return matching pages. The site code does not write searches to an
              application database. Automatic per-request Worker invocation logging is disabled
              because the query appears in the request URL; application diagnostics and uncaught
              exception logging remain enabled.
            </p>
          </section>

          <section aria-labelledby="download-edge">
            <h2 id="download-edge" className="text-xl font-semibold text-foreground">
              Installer and update requests
            </h2>
            <p className="mt-3">
              Installers, checksums, Compose files and the update manifest are served from{" "}
              <code>get.otterdeploy.com</code>. If the repository's optional install counters are
              enabled, an Analytics Engine datapoint contains the requested file, requested version,
              country code and a secret-keyed identifier derived from the connecting IP address. It
              excludes the raw IP address and user agent. Rotating the secret breaks correlation
              between old and new identifiers.
            </p>
            <p className="mt-3">
              No installation ID is added by the product. A running installation can request the
              public version manifest to check for updates, just as a browser or command-line client
              can request any other file from that host.
            </p>
          </section>

          <section aria-labelledby="questions">
            <h2 id="questions" className="text-xl font-semibold text-foreground">
              Questions and sensitive reports
            </h2>
            <p className="mt-3">
              For a non-sensitive question about this page, open a{" "}
              <a
                href={`${GITHUB_URL}/issues`}
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                GitHub issue
              </a>
              , but do not post secrets or personal information. For a suspected vulnerability,
              follow the repository's{" "}
              <a
                href={`${GITHUB_URL}/security/policy`}
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                security reporting policy
              </a>
              , which explains how to request a private channel without disclosing details publicly.
            </p>
          </section>
        </div>

        <p className="mt-14 border-t border-border pt-6 font-mono text-xs text-muted-foreground">
          Updated September 3, 2026
        </p>
      </main>
    </div>
  );
}
