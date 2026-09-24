import { defineCommand } from "citty";

import { clearConfig, listContexts, normalizeUrl, setCurrent } from "../config";
import { cmd } from "../lib/name";
import { suggestions } from "../lib/suggest";
import { abort, dim, hint, note, ok, section, stateGlyph, table } from "../lib/ui";

/**
 * Which control plane commands talk to.
 *
 * `login` adds one and makes it current; this is how you move between the ones
 * you already hold without signing in again. The org selection, the token and
 * the web origin all travel with the host, so switching here switches all
 * three — see `config.ts`.
 */
const listContextsCommand = defineCommand({
  meta: { name: "list", description: "List the control planes you're signed into" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  run({ args }) {
    const contexts = listContexts();

    if (args.json) {
      const rows = contexts.map(({ url, context, isCurrent }) => ({
        url,
        isCurrent,
        org: context.orgSlug ?? null,
        // Never the token itself: this output gets pasted into issues.
        authenticated: Boolean(context.token),
      }));
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (contexts.length === 0) {
      note("You're not signed into any control plane yet.");
      hint(`run \`${cmd("login <url>")}\``);
      return;
    }

    section("Control planes");
    table(
      [{ header: "" }, { header: "url" }, { header: "org" }],
      contexts.map(({ url, context, isCurrent }) => [
        // The live glyph for the active one, the same vocabulary `org list`
        // uses, rather than an asterisk.
        isCurrent ? stateGlyph("running") : " ",
        url,
        dim(context.orgSlug ?? "none"),
      ]),
    );
  },
});

const useContext = defineCommand({
  meta: { name: "use", description: "Switch to a control plane you're signed into" },
  args: {
    url: { type: "positional", required: true, description: "Control plane URL" },
  },
  run({ args }) {
    const url = normalizeUrl(args.url);
    if (!url) {
      abort(`"${args.url}" is not a valid control plane URL.`, "include the scheme, e.g. https://");
    }

    const contexts = listContexts();
    const match = contexts.find((c) => c.url === url);
    if (!match) {
      // Signed into nothing here is a different problem from a typo, and the
      // fix differs too: one is a login, the other is a correction.
      const near = suggestions(
        url,
        contexts.map((c) => c.url),
      );
      abort(
        `Not signed into ${url}.`,
        ...near.map((s) => `did you mean \`${s}\`?`),
        `run \`${cmd(`login ${url}`)}\` to sign in`,
      );
    }

    setCurrent(url);
    ok(
      `Now using ${url}${match.context.orgSlug ? ` ${dim(`(org ${match.context.orgSlug})`)}` : ""}.`,
    );
    if (!match.context.token) {
      hint(`you're signed out of this one — run \`${cmd(`login ${url}`)}\``);
    }
  },
});

const removeContext = defineCommand({
  meta: { name: "remove", description: "Forget a control plane entirely" },
  args: {
    url: { type: "positional", required: true, description: "Control plane URL" },
  },
  run({ args }) {
    const url = normalizeUrl(args.url);
    if (!url) abort(`"${args.url}" is not a valid control plane URL.`);
    clearConfig(url);
    ok(`Forgot ${url}.`);
  },
});

export const contextCommand = defineCommand({
  meta: { name: "context", description: "Switch between control planes" },
  subCommands: {
    list: listContextsCommand,
    use: useContext,
    remove: removeContext,
  },
});
