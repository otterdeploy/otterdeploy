/**
 * SQL CASE builder for marketing channels, generated from the SAME rule table
 * (`CHANNEL_RULES` in @otterdeploy/shared/channels) that `classifyChannel`
 * evaluates in JS — one vocabulary, two engines. Every user-adjacent value is
 * bound as a parameter; only channel names from our own const table are
 * inlined via `sql.raw` (closed set, never user input).
 */

import type { Channel } from "@otterdeploy/shared/channels";

import { baseDomainPattern, CHANNEL_RULES, MEDIUM_CHANNELS } from "@otterdeploy/shared/channels";
import { sql, type SQL } from "drizzle-orm";

export interface ChannelColumns {
  referrerHost: SQL | SQL.Aliased;
  utmSource: SQL | SQL.Aliased;
  utmMedium: SQL | SQL.Aliased;
}

function lit(channel: Channel): SQL {
  // Channel names come from the shared const table, not from input.
  return sql.raw(`'${channel}'`);
}

/** `col` matches an exact host, any subdomain, or a base-domain pattern. */
function hostMatch(
  col: SQL | SQL.Aliased,
  hosts: readonly string[],
  baseDomains: readonly string[],
): SQL {
  const parts: SQL[] = [];
  for (const h of hosts) parts.push(sql`${col} = ${h}`, sql`${col} LIKE ${`%.${h}`}`);
  for (const b of baseDomains) parts.push(sql`${col} ~ ${baseDomainPattern(b)}`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

function mediumIn(col: SQL | SQL.Aliased, mediums: string[]): SQL {
  return sql`lower(${col}) IN (${sql.join(
    mediums.map((m) => sql`${m}`),
    sql`, `,
  )})`;
}

/** True when the visit's paid traffic came from a social network: a social
 *  utm_source (name or host) or a social referrer. */
function socialPaidSignal(cols: ChannelColumns): SQL {
  const source = sql`lower(${cols.utmSource})`;
  const sourceName = sql`${source} IN (${sql.join(
    CHANNEL_RULES.socialSources.map((s) => sql`${s}`),
    sql`, `,
  )})`;
  const sourceHost = hostMatch(source, CHANNEL_RULES.socialHosts, CHANNEL_RULES.socialBaseDomains);
  const referrer = hostMatch(
    cols.referrerHost,
    CHANNEL_RULES.socialHosts,
    CHANNEL_RULES.socialBaseDomains,
  );
  return sql`(${sourceName} OR ${sourceHost} OR ${referrer})`;
}

/**
 * The classification CASE. Mirrors `classifyChannel` rule for rule: medium
 * table first (paid search flipping to Paid Social on a social source or
 * referrer), then referrer host lists, then any-UTM ⇒ Referral, nothing ⇒
 * Direct, else Referral.
 */
export function channelCase(cols: ChannelColumns): SQL {
  const byChannel = new Map<Channel, string[]>();
  for (const [medium, channel] of Object.entries(MEDIUM_CHANNELS)) {
    const list = byChannel.get(channel) ?? [];
    list.push(medium);
    byChannel.set(channel, list);
  }

  const arms: SQL[] = [];
  for (const [channel, mediums] of byChannel) {
    const then =
      channel === "Paid Search"
        ? sql`CASE WHEN ${socialPaidSignal(cols)} THEN ${lit("Paid Social")} ELSE ${lit("Paid Search")} END`
        : lit(channel);
    arms.push(sql`WHEN ${mediumIn(cols.utmMedium, mediums)} THEN ${then}`);
  }

  const search = hostMatch(
    cols.referrerHost,
    CHANNEL_RULES.searchHosts,
    CHANNEL_RULES.searchBaseDomains,
  );
  const video = hostMatch(cols.referrerHost, CHANNEL_RULES.videoHosts, []);
  const social = hostMatch(
    cols.referrerHost,
    CHANNEL_RULES.socialHosts,
    CHANNEL_RULES.socialBaseDomains,
  );
  arms.push(
    sql`WHEN ${search} THEN ${lit("Organic Search")}`,
    sql`WHEN ${video} THEN ${lit("Video")}`,
    sql`WHEN ${social} THEN ${lit("Organic Social")}`,
    sql`WHEN ${cols.utmSource} IS NOT NULL OR ${cols.utmMedium} IS NOT NULL THEN ${lit("Referral")}`,
    sql`WHEN ${cols.referrerHost} IS NULL THEN ${lit("Direct")}`,
  );

  return sql`(CASE ${sql.join(arms, sql` `)} ELSE ${lit("Referral")} END)`;
}
