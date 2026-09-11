/**
 * What actually SHIPPED, in one cell.
 *
 * Split from the rest of the cells because it is the only one with real
 * branching in it: three different kinds of provenance, each identified a
 * different way, and the branch is the whole content of the column.
 */

import type { DeploymentRow } from "@/features/deployments/table/deployment-cells";

import { shortImageRef } from "@/shared/lib/image-ref";

/**
 * What actually shipped: a commit, an uploaded tarball, or an image.
 *
 * A git deploy is identified by its message — nobody remembers a sha — so the
 * message leads and the short sha anchors it. A CLI upload has no commit but
 * its content hash is honest provenance. An image or database deploy has only
 * the ref it launched, and that is labelled as such so a bare tag is not read
 * as a commit.
 */
export function DeploymentShipped({ row }: { row: DeploymentRow }) {
  if (row.gitSha !== null) {
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <ShortRef value={row.gitSha} />
        <span className="truncate" title={row.gitCommitMessage ?? undefined}>
          {row.gitCommitMessage ?? row.gitRef ?? "—"}
        </span>
      </span>
    );
  }
  if (row.sourceSha !== null) {
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <ShortRef value={row.sourceSha} />
        <SourceMark>source</SourceMark>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-mono text-[12px]" title={row.image}>
        {shortImageRef(row.image)}
      </span>
      <SourceMark>image</SourceMark>
    </span>
  );
}

function ShortRef({ value }: { value: string }) {
  return (
    <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title={value}>
      {value.slice(0, 7)}
    </span>
  );
}

function SourceMark({ children }: { children: string }) {
  return (
    <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70">
      {children}
    </span>
  );
}
