import { Fragment } from "react";
import {
  Database02Icon,
  LinkSquare02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { DeploymentProtectionCell } from "@/features/projects/components/networking/deployment-protection-cell";
import { RouteDirectivesButton } from "@/features/projects/components/networking/route-directives-dialog";

import type { RouteGroup } from "./networking-routes-model";

export function RouteGroupRows({
  group,
  projectId,
}: {
  group: RouteGroup;
  projectId: string;
}) {
  return (
    <Fragment>
      <TableRow className="border-b-0 bg-muted/25 hover:bg-muted/25">
        <TableCell colSpan={5} className="py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={
                  group.kind === "database" ? Database02Icon : ServerStack01Icon
                }
                strokeWidth={1.8}
                className="size-4 text-muted-foreground"
              />
              <span className="font-mono text-[13px] font-medium">
                {group.name}
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {group.internalHost}:{group.internalPort}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {group.routes.length} route
              {group.routes.length === 1 ? "" : "s"}
            </span>
          </div>
        </TableCell>
      </TableRow>
      {group.routes.map((r, i) => (
        <TableRow
          key={r.id}
          className={i === group.routes.length - 1 ? undefined : "border-b-0"}
        >
          <TableCell className="py-2.5">
            <div className="flex items-center gap-2 pl-6">
              <span className="text-muted-foreground/40">└</span>
              {r.isHttp ? (
                <a
                  href={r.publicHost}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "group inline-flex items-center gap-1 font-mono text-[12.5px] hover:underline",
                    r.enabled ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {r.publicHost}
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    strokeWidth={2}
                    className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                  />
                </a>
              ) : (
                <span
                  className={cn(
                    "font-mono text-[12.5px]",
                    r.enabled ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {r.publicHost}
                </span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  r.tls === "letsencrypt"
                    ? "bg-success"
                    : "bg-muted-foreground/60",
                )}
              />
              {r.tls}
            </span>
          </TableCell>
          <TableCell>
            <DeploymentProtectionCell route={r} projectId={projectId} />
          </TableCell>
          <TableCell>
            <Badge
              variant={r.enabled ? "outline" : "secondary"}
              className="font-mono text-[10px] font-normal"
            >
              {r.enabled ? "enabled" : "disabled"}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            {r.isHttp ? (
              <RouteDirectivesButton
                routeId={r.id}
                domain={r.domain}
                customDirectives={r.customDirectives}
              />
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </Fragment>
  );
}
