import { asc } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vite-plus/test";

import { overfetch, planCursor, snapPage } from "./pagination";

const events = pgTable("events", {
  id: text("id").primaryKey(),
  at: timestamp("at").notNull(),
});

const dialect = new PgDialect();
const orderText = (clauses: { orderBy: ReturnType<typeof planCursor>["orderBy"] }) =>
  clauses.orderBy.map((clause) => dialect.sqlToQuery(clause).sql).join(", ");

const plan = (over: Partial<Parameters<typeof planCursor>[0]> = {}) =>
  planCursor({
    cursor: null,
    direction: "next",
    cursorColumn: events.at,
    tiebreakColumn: events.id,
    ...over,
  });

describe("cursor predicate", () => {
  test("the first page has no predicate", () => {
    expect(plan().condition).toBeUndefined();
  });

  test("next walks toward older rows", () => {
    const condition = plan({ cursor: 1_757_000_000_000 }).condition;
    expect(condition).toBeDefined();
    if (!condition) throw new Error("unreachable");
    const query = dialect.sqlToQuery(condition);
    expect(query.sql).toBe(`"events"."at" < $1`);
    expect(query.params).toEqual(["2025-09-04T15:33:20.000Z"]);
  });

  test("prev walks toward newer rows and must be reversed", () => {
    const previous = plan({ cursor: 1_757_000_000_000, direction: "prev" });
    expect(previous.condition).toBeDefined();
    if (!previous.condition) throw new Error("unreachable");
    expect(dialect.sqlToQuery(previous.condition).sql).toBe(`"events"."at" > $1`);
    expect(previous.needsReverse).toBe(true);
  });
});

describe("ordering", () => {
  test("cursor first, tiebreak last", () => {
    // Without a unique column ordered last, rows sharing a timestamp come back
    // in whatever order the plan produced — and that order changes between
    // refetches, so rows visibly shuffle under the reader.
    expect(orderText(plan())).toBe(`"events"."at" desc, "events"."id" desc`);
  });

  test("a user sort sits between the cursor and the tiebreak", () => {
    const sorted = plan({ sort: asc(events.id) });
    expect(orderText(sorted)).toBe(`"events"."at" desc, "events"."id" asc, "events"."id" desc`);
  });

  test("the tiebreak follows the cursor's direction", () => {
    // A `prev` page is read ascending and reversed afterwards, so its tiebreak
    // has to be ascending too or the reversed page disagrees with its
    // neighbours about the order of a tied group.
    expect(orderText(plan({ direction: "prev" }))).toBe(`"events"."at" asc, "events"."id" asc`);
  });
});

describe("page boundaries never split a tie", () => {
  const row = (id: string, at: number) => ({ id, at });
  const cursorOf = (r: { at: number }) => r.at;

  test("asks for one extra row", () => {
    expect(overfetch(50)).toBe(51);
  });

  test("a full page with no tie at the boundary is kept whole", () => {
    const rows = [row("a", 3), row("b", 2), row("c", 1)];
    expect(snapPage(rows, 2, cursorOf).rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("a tie contained INSIDE the page is kept — nothing is lost", () => {
    const rows = [row("a", 3), row("b", 2), row("c", 2), row("d", 1)];
    expect(snapPage(rows, 3, cursorOf).rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("a tie straddling the boundary is left for the next page", () => {
    // The next page is fetched with a strict `<`, so `c` — sharing `b`'s cursor
    // value but falling outside the page — would never be returned by ANY page.
    // Ending the page before the group is the only way to keep it reachable.
    const rows = [row("a", 3), row("b", 2), row("c", 2), row("d", 1)];
    const page = snapPage(rows, 2, cursorOf);
    expect(page.rows.map((r) => r.id)).toEqual(["a"]);
  });

  test("a short page is returned untouched", () => {
    const rows = [row("a", 3), row("b", 2)];
    const page = snapPage(rows, 10, cursorOf);
    expect(page.rows).toHaveLength(2);
    expect(page.tiedAt).toBeNull();
  });

  test("one cursor value spanning the whole page empties it, so the caller can widen", () => {
    // Degenerate: there is no boundary to retreat to. An empty page plus the
    // tied value tells the caller to fetch the entire group and overflow.
    const rows = [row("a", 5), row("b", 5), row("c", 5)];
    const page = snapPage(rows, 2, cursorOf);
    expect(page.rows).toEqual([]);
    expect(page.tiedAt).toBe(5);
  });

  test("an unreadable cursor value trims without guessing", () => {
    const rows = [row("a", 3), row("b", 2), row("c", 1)];
    const page = snapPage(rows, 2, () => null);
    expect(page.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.tiedAt).toBeNull();
  });
});
