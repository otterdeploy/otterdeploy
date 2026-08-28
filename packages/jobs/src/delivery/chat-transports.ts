/**
 * The three chat transports: Slack, Discord, Telegram.
 *
 * Split from ./channels.ts because that file is at its line cap and because
 * these three are the ones that share a shape — a severity badge, a title that
 * names the subject, an aligned detail table, and a footer carrying the event
 * id. The rest (email, webhook, PagerDuty, push) answer to their provider's
 * schema instead.
 *
 * None of them draws a colour stripe any more. See ./message.ts for why the
 * badge is an emoji and not a coloured word.
 */

import type { ChannelEvent, DeliveryResult, ResolvedChannel } from "./types";

import {
  SEVERITY,
  alignedTable,
  detailRows,
  escapeHtml,
  label,
  subjectOf,
  titleOf,
} from "./message";
import { post } from "./post";

/** Discord components: 17 = Container, 10 = TextDisplay, 14 = Separator.
 *  `IS_COMPONENTS_V2` is message flag 1<<15; with it set the message may carry
 *  no `content` and no `embeds`, which is why Discord builds a payload here
 *  rather than editing the old one. */
const CONTAINER = 17;
const TEXT = 10;
const SEPARATOR = 14;
const IS_COMPONENTS_V2 = 1 << 15;

/** The bot posts as the product, not as the channel. `username: c.name` made
 *  every alert appear to come from a sender called "#alerts" — the channel's
 *  own name — so the product never appeared where a reader looks to identify
 *  who sent it. */
const SENDER = "otterdeploy";

export function deliverSlack(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  const rows = detailRows(e.data, subject);

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${s.emoji} *${s.word}*\n*${titleOf(e.title, subject)}*\n${e.message}`,
      },
    },
  ];
  // Slack renders at most 10 fields per section and truncates silently past
  // that, so the overflow is dropped here deliberately rather than by Slack.
  if (rows.length > 0)
    blocks.push({
      type: "section",
      fields: rows.slice(0, 10).map(([k, v]) => ({ type: "mrkdwn", text: `*${label(k)}*\n${v}` })),
    });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `otterdeploy · \`${e.eventId}\`` }],
  });

  return post(c.target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Top-level blocks, not a coloured attachment: the attachment's `color` was
    // the severity stripe, and the emoji badge now carries that.
    body: JSON.stringify({ username: SENDER, blocks }),
  });
}

/**
 * Discord, as a Components V2 container.
 *
 * No embed, so no colour stripe and no left indent — on a phone the indent was
 * what made every alert feel boxed-in. Severity is the emoji badge; the detail
 * table is a code fence, which is the only construct in Discord that aligns
 * columns (there is no markdown table syntax, and embed fields do not line up
 * across rows).
 */
export function deliverDiscord(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  const table = alignedTable(detailRows(e.data, subject));

  const head = `${s.emoji} **${s.word}**\n## ${titleOf(e.title, subject)}`;
  const parts: Array<Record<string, unknown>> = [
    { type: TEXT, content: e.message ? `${head}\n${e.message}` : head },
  ];
  if (table !== undefined) {
    parts.push({ type: SEPARATOR }, { type: TEXT, content: `\`\`\`\n${table}\n\`\`\`` });
  }
  parts.push({ type: SEPARATOR }, { type: TEXT, content: `-# otterdeploy · ${e.eventId}` });

  return post(c.target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: SENDER,
      flags: IS_COMPONENTS_V2,
      components: [{ type: CONTAINER, components: parts }],
    }),
  });
}

export function deliverTelegram(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  if (!c.secret) return Promise.resolve({ ok: false, error: "no bot token" });
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  const table = alignedTable(detailRows(e.data, subject));

  // Telegram has no colour affordance of any kind, so this is the channel where
  // the emoji does the most work: without it a crash and a successful backup
  // were typographically identical.
  const parts = [`${s.emoji} <b>${escapeHtml(titleOf(e.title, subject))}</b>`];
  if (e.message) parts.push(escapeHtml(e.message));
  if (table !== undefined) parts.push(`<pre>${escapeHtml(table)}</pre>`);
  parts.push(`<i>${escapeHtml(e.eventId)}</i>`);

  return post(`https://api.telegram.org/bot${c.secret}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: c.target,
      text: parts.join("\n\n"),
      parse_mode: "HTML",
      // Alerts link back to the dashboard; an unfurl card per alert would
      // double the height of the channel.
      disable_web_page_preview: true,
    }),
  });
}
