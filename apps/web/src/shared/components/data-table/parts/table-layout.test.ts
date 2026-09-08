import { describe, expect, test } from "vite-plus/test";

import { widthVars } from "./table-header";
import { nextIndex } from "./use-row-navigation";

describe("widthVars", () => {
  test("a column with no declared width absorbs leftover space", () => {
    expect(
      widthVars([{ id: "action", declared: undefined, resized: undefined, min: 120 }]),
    ).toEqual({
      "--col-action-size": "120px",
      "--col-action-min": "120px",
      "--col-action-grow": "1",
    });
  });

  test("a declared width is exactly that wide and does not grow", () => {
    expect(widthVars([{ id: "at", declared: 160, resized: undefined, min: 80 }])).toMatchObject({
      "--col-at-size": "160px",
      "--col-at-grow": "0",
    });
  });

  test("a dragged width wins over the declared one", () => {
    // The whole point of persisting sizing: the reader's width outranks the
    // schema's, for as long as they keep it.
    expect(widthVars([{ id: "at", declared: 160, resized: 240, min: 80 }])).toMatchObject({
      "--col-at-size": "240px",
    });
  });

  test("dragging a flexible column stops it flexing", () => {
    // Otherwise the drag would move the column's basis while leftover space
    // kept overriding it, and the edge would not follow the cursor.
    expect(
      widthVars([{ id: "reason", declared: undefined, resized: 300, min: 120 }]),
    ).toMatchObject({ "--col-reason-size": "300px", "--col-reason-grow": "0" });
  });

  test("the minimum is always published, so a column never collapses", () => {
    expect(widthVars([{ id: "q", declared: 90, resized: undefined, min: 80 }])).toMatchObject({
      "--col-q-min": "80px",
    });
  });
});

describe("nextIndex", () => {
  test("j and the down arrow are the same key", () => {
    expect(nextIndex("j", 3, 10)).toBe(4);
    expect(nextIndex("ArrowDown", 3, 10)).toBe(4);
    expect(nextIndex("k", 3, 10)).toBe(2);
    expect(nextIndex("ArrowUp", 3, 10)).toBe(2);
  });

  test("entering the table from nowhere lands on the first row, either way", () => {
    // -1 is "the reader has not entered the table yet". Up must not wrap to
    // the end of a feed that may hold ten thousand rows.
    expect(nextIndex("ArrowDown", -1, 10)).toBe(0);
    expect(nextIndex("ArrowUp", -1, 10)).toBe(0);
  });

  test("the ends hold rather than wrap", () => {
    expect(nextIndex("ArrowUp", 0, 10)).toBe(0);
    expect(nextIndex("ArrowDown", 9, 10)).toBe(9);
  });

  test("Home and End jump to the ends", () => {
    expect(nextIndex("Home", 5, 10)).toBe(0);
    expect(nextIndex("End", 5, 10)).toBe(9);
  });

  test("an empty table swallows nothing", () => {
    // `null` is what keeps the key's default behaviour: with no rows, the
    // arrows still scroll the page.
    expect(nextIndex("ArrowDown", -1, 0)).toBeNull();
    expect(nextIndex("End", -1, 0)).toBeNull();
  });

  test("a key that is not ours stays not ours", () => {
    expect(nextIndex("a", 0, 10)).toBeNull();
    expect(nextIndex("Enter", 0, 10)).toBeNull();
    expect(nextIndex("PageDown", 0, 10)).toBeNull();
  });
});
