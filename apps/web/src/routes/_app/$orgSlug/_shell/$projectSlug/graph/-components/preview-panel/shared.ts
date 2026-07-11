/**
 * Shared bits for the PR-preview detail panel tabs — status-pill styling,
 * the label/badge utility classes, and the preview row types inferred from
 * the `project.previews.list` procedure.
 */
import { orpc } from "@/shared/server/orpc";

export const badgeBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-medium";
export const label =
  "font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase";

const STATUS_PILL: Record<string, string> = {
  running: "bg-success/12 text-success",
  starting: "bg-warning/12 text-warning",
  building: "bg-warning/12 text-warning",
  pending: "bg-warning/12 text-warning",
  crashed: "bg-destructive/12 text-destructive",
  failed: "bg-destructive/12 text-destructive",
};
export const pillClass = (s: string) => STATUS_PILL[s] ?? "bg-muted text-muted-foreground";

export type Preview = Awaited<ReturnType<typeof orpc.project.previews.list.call>>[number];
export type PreviewService = Preview["services"][number];
