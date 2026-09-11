/**
 * The tints a surface may put on a row.
 *
 * Named rather than written inline for the reason every shared token exists:
 * "the rows worth looking at" should be one colour across the four feeds, and
 * four hand-written `bg-destructive/[0.04]`s were already three chances to pick
 * a fifth. They set `--row-tint`, which is what `tinted-surface` paints and
 * what a pinned cell inherits — see index.css.
 */
export const ROW_TINT = {
  /** The row this page gets opened for: a failed deploy, a 5xx, a live ban. */
  danger: "[--row-tint:var(--row-tint-danger)]",
} as const;
