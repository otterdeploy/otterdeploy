import { useState } from "react";

import {
  ArrowRight01Icon,
  EarthIcon,
  Link01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { RouteCertificate } from "@/features/projects/components/networking/certificate-status";

import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { RouteGroupRows } from "./networking-route-group";
import { groupRoutes, type RouteGroup, type RouteRow } from "./networking-routes-model";

export {
  mapRoute,
  type ResourceListItem,
  type RouteRow,
} from "./networking-routes-model";

/**
 * The routes table: the whole of Networking. Each row expands to the TLS
 * certificate and access controls for that route, which used to be two
 * separate sub-tabs listing the same domains over again.
 */
export function RoutesTable({
  rows,
  projectId,
  isLoading,
  certsByDomain,
  certsLoading,
}: {
  rows: RouteRow[];
  projectId: string;
  isLoading: boolean;
  certsByDomain: Map<string, RouteCertificate>;
  certsLoading: boolean;
}) {
  const groups: RouteGroup[] = groupRoutes(rows);
  // One row open at a time: these panels are tall, and a stack of expanded
  // routes is the wall-of-config the tabs were hiding in the first place.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const acmeCount = rows.filter((r) => r.tls === "letsencrypt" && r.enabled).length;
  const httpCount = rows.filter((r) => r.isHttp).length;
  // Public ports are derived from the routes actually published: HTTP terminates
  // on :443, a TCP route (e.g. an exposed database) contributes its own port.
  const publicPorts = Array.from(
    new Set(rows.flatMap((r) => (r.enabled ? [r.isHttp ? 443 : r.internalPort] : []))),
  ).sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <FlowDiagram
        publicPorts={publicPorts}
        httpCount={httpCount}
        acmeCount={acmeCount}
        upstreamCount={rows.length}
      />

      <Card className="gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-[10px] font-semibold tracking-[0.08em] uppercase">
                Public hostname
              </TableHead>
              <TableHead className="text-[10px] font-semibold tracking-[0.08em] uppercase">
                TLS
              </TableHead>
              <TableHead className="text-[10px] font-semibold tracking-[0.08em] uppercase">
                Protection
              </TableHead>
              <TableHead className="text-[10px] font-semibold tracking-[0.08em] uppercase">
                Status
              </TableHead>
              <TableHead className="w-10 text-right text-[10px] font-semibold tracking-[0.08em] uppercase">
                Custom
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && rows.length === 0 ? (
              <SkeletonRows />
            ) : groups.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="p-0">
                  <Empty className="border-0 bg-transparent">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <HugeiconsIcon
                          icon={Link01Icon}
                          strokeWidth={1.6}
                          className="size-5 text-muted-foreground"
                        />
                      </EmptyMedia>
                      <EmptyTitle>No routes yet</EmptyTitle>
                      <EmptyDescription>
                        Expose a service or enable public access on a database to
                        publish it through the Caddy edge proxy.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <RouteGroupRows
                  key={group.key}
                  group={group}
                  projectId={projectId}
                  expandedId={expandedId}
                  onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                  certsByDomain={certsByDomain}
                  certsLoading={certsLoading}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FlowDiagram({
  publicPorts,
  httpCount,
  acmeCount,
  upstreamCount,
}: {
  publicPorts: number[];
  httpCount: number;
  acmeCount: number;
  upstreamCount: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
      <FlowCard
        icon={EarthIcon}
        label="Public internet"
        detail={
          publicPorts.length ? publicPorts.map((p) => `:${p}`).join(" · ") : "no ports exposed"
        }
      />
      <FlowArrow />
      <FlowCard
        icon={ServerStack01Icon}
        label="Caddy edge proxy"
        detail={`${httpCount} http · ${acmeCount} letsencrypt`}
        active
      />
      <FlowArrow />
      <FlowCard
        icon={Link01Icon}
        label="Service mesh"
        detail={`${upstreamCount} upstream${upstreamCount === 1 ? "" : "s"}`}
      />
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 5 }).map((__, j) => (
            <TableCell key={j} className="py-3">
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function FlowCard({
  icon,
  label,
  detail,
  active,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-1 rounded-lg p-3.5 transition-colors",
        active ? "border-foreground" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
        {label}
      </div>
      <div className="font-mono text-[13px]">{detail}</div>
    </Card>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground/40">
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
    </div>
  );
}
