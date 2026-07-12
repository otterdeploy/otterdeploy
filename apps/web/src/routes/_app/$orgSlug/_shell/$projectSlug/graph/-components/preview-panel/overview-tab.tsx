import { cn } from "@/shared/lib/utils";

import { badgeBase, label, pillClass, type Preview } from "./shared";

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
            <li key={svc.resourceId} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {svc.serviceName}
              </span>
              {svc.url ? (
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
                >
                  {svc.url.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {svc.deployedSha ? (
                <span
                  className="shrink-0 font-mono text-[11px] text-muted-foreground"
                  title={`Deployed commit ${svc.deployedSha}`}
                >
                  {svc.deployedSha.slice(0, 7)}
                </span>
              ) : null}
              <span className={cn(badgeBase, pillClass(svc.status))}>
                <span className="size-1.5 rounded-full bg-current" />
                {svc.status === "none" ? "queued" : svc.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
