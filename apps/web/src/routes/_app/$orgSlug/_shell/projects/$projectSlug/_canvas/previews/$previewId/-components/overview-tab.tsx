import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import {
  badgeBase,
  freshness,
  label,
  pillClass,
  type Preview,
  type PreviewService,
} from "./shared";

/**
 * What this service is serving, in words.
 *
 * The status pill answers "is a container up". This answers "is the commit I
 * pushed the one I'd be reviewing". The question someone opening a preview
 * from a pull request is actually asking, and the one a green pill can silently
 * get wrong.
 */
function FreshnessNote({ svc, headSha }: { svc: PreviewService; headSha: string }) {
  const state = freshness(svc, headSha);
  if (state.kind === "current") return null;
  if (state.kind === "none") {
    return (
      <span className="shrink-0 text-[11.5px] text-muted-foreground">nothing serving yet</span>
    );
  }
  // Serving something older than head. Name what is up AND what it isn't, so
  // the reader doesn't have to compare two short hashes themselves.
  return (
    <span
      className="shrink-0 text-[11.5px] text-warning"
      title={`Serving ${state.serving}, which is not this preview's head commit (${headSha})`}
    >
      serving {state.serving.slice(0, 7)} · not head
    </span>
  );
}

export function OverviewTab({ preview }: { preview: Preview }) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        <dt className={label}>branch</dt>
        <dd className="font-mono text-foreground/90">{preview.branch}</dd>
        <dt className={label}>commit</dt>
        <dd className="font-mono text-foreground/90">{preview.headSha.slice(0, 12)}</dd>
        <dt className={label}>db</dt>
        <dd>{preview.dbBranched ? "isolated branch" : "shared with base"}</dd>
        <dt className={label}>expires</dt>
        <dd>
          {preview.autoTeardownAt
            ? new Date(preview.autoTeardownAt).toLocaleString()
            : "pinned (keep-alive)"}
        </dd>
      </dl>
      <div>
        <div className={label}>services</div>
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {preview.services.map((svc) => (
            <li key={svc.resourceId} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {svc.serviceName}
                </span>
                <FreshnessNote svc={svc} headSha={preview.headSha} />
                <span className={cn(badgeBase, pillClass(svc.status))}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {svc.status === "none" ? "queued" : svc.status}
                </span>
              </div>
              {svc.url ? (
                // The whole point of a preview is opening it, so the address is
                // a real target rather than a caption.
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex w-fit items-center gap-1 font-mono text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {svc.url.replace(/^https?:\/\//, "")}
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    strokeWidth={2}
                    className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                  />
                </a>
              ) : (
                // Honest about the gap: not yet routed is not the same as broken.
                <span className="font-mono text-[11.5px] text-muted-foreground/70">
                  no public address yet
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
