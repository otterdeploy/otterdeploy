/**
 * Tables for the template detail modal. Both render from the PARSED compose
 * (or the typed catalog entry), never from ad-hoc display copies.
 */
import type { ParsedCompose } from "@otterdeploy/api/stack/compose/types";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import type { TemplateEnvVar } from "../catalog";

export function IncludedServicesTable({ parsed }: { parsed: ParsedCompose }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>Ports</TableHead>
            <TableHead>Volumes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parsed.services.map((svc) => {
            const volumes = svc.volumes.flatMap((m) =>
              m.type === "volume" && m.source ? [m.source] : [],
            );
            return (
              <TableRow key={svc.name}>
                <TableCell className="font-medium">{svc.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {svc.image}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {svc.ports.length > 0 ? svc.ports.map((p) => p.target).join(", ") : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {volumes.length > 0 ? volumes.join(", ") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function RequiredEnvTable({ requiredEnv }: { requiredEnv: TemplateEnvVar[] }) {
  if (requiredEnv.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground ring-1 ring-foreground/10">
        No required variables — this template deploys with safe defaults.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Suggested value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requiredEnv.map((v) => (
            <TableRow key={v.key}>
              <TableCell className="font-mono text-xs font-medium">{v.key}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{v.description}</TableCell>
              <TableCell className="font-mono text-[11px] text-muted-foreground">
                {v.generateHint ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
