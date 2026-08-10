import { Fragment } from "react";
import {
  ArrowRight01Icon,
  Database02Icon,
  LinkSquare02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { RouteCertificate } from "@/features/projects/components/networking/certificate-status";

import { CERT_STATUS } from "@/features/projects/components/networking/certificate-status";
import { DeploymentProtectionCell } from "@/features/projects/components/networking/deployment-protection-cell";
import { RouteDetailPanel } from "@/features/projects/components/networking/route-detail-panel";
import { RoutePolicyButton } from "@/features/projects/components/networking/route-directives-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import type { RouteGroup } from "./networking-routes-model";

/** Hostname · TLS · Protection · Status · Custom. The disclosure chevron rides
 *  inside the hostname cell rather than claiming a column of its own. */
const COLUMN_COUNT = 5;

/** The TLS cell reports the issuance MODE from the route record, plus. Once a
 *  probe has landed. The live health of what the edge is actually serving.
 *  Mode alone was misleading: a route can say "letsencrypt" while the edge
 *  serves an expired cert. */
function TlsCell({ mode, cert }: { mode: string; cert: RouteCertificate | undefined }) {
  const status = cert ? CERT_STATUS[cert.status] : null;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
      <span
        className={cn(
          "size-1.5 rounded-full",
          status ? status.dot : mode === "letsencrypt" ? "bg-success" : "bg-muted-foreground/60",
        )}
      />
      {mode}
      {status && cert?.status !== "valid" ? (
        <span className={cn("text-[11px]", status.text)}>· {status.label.toLowerCase()}</span>
      ) : null}
    </span>
  );
}

export function RouteGroupRows({
  group,
  projectId,
  expandedId,
  onToggle,
  certsByDomain,
  certsLoading,
}: {
  group: RouteGroup;
  projectId: string;
  expandedId: string | null;
  onToggle: (routeId: string) => void;
  certsByDomain: Map<string, RouteCertificate>;
  certsLoading: boolean;
}) {
  return (
    <Fragment>
      <TableRow className="border-b-0 bg-muted/25 hover:bg-muted/25">
        <TableCell colSpan={COLUMN_COUNT} className="py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={group.kind === "database" ? Database02Icon : ServerStack01Icon}
                strokeWidth={1.8}
                className="size-4 text-muted-foreground"
              />
              <span className="font-mono text-[13px] font-medium">{group.name}</span>
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
      {group.routes.map((r, i) => {
        const open = expandedId === r.id;
        const isLast = i === group.routes.length - 1;
        const cert = certsByDomain.get(r.domain);
        return (
          <Fragment key={r.id}>
            <TableRow
              className={cn(
                "cursor-pointer",
                !open && !isLast && "border-b-0",
                open && "border-b-0 bg-muted/20",
              )}
              onClick={() => onToggle(r.id)}
              aria-expanded={open}
            >
              <TableCell className="py-2.5">
                <div className="flex items-center gap-2 pl-6">
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  {r.isHttp ? (
                    <a
                      href={r.publicHost}
                      target="_blank"
                      rel="noopener noreferrer"
                      // The row toggles; the link navigates. Without this the
                      // link would also collapse/expand the row behind it.
                      onClick={(e) => e.stopPropagation()}
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
                <TlsCell mode={r.tls} cert={cert} />
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
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
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {r.isHttp ? (
                  <RoutePolicyButton
                    routeId={r.id}
                    domain={r.domain}
                    routePolicy={r.routePolicy}
                  />
                ) : null}
              </TableCell>
            </TableRow>
            {open ? (
              <TableRow
                className={cn("bg-muted/20 hover:bg-muted/20", !isLast && "border-b-0")}
              >
                <TableCell colSpan={COLUMN_COUNT} className="p-0">
                  <RouteDetailPanel
                    routeId={r.id}
                    domain={r.domain}
                    isHttp={r.isHttp}
                    isProtected={r.protected}
                    cert={cert}
                    certsLoading={certsLoading}
                  />
                </TableCell>
              </TableRow>
            ) : null}
          </Fragment>
        );
      })}
    </Fragment>
  );
}
