/**
 * Tables for the template detail modal. Both render from the PARSED compose
 * (or the typed catalog entry), never from ad-hoc display copies.
 */
import type { ParsedCompose } from "@otterdeploy/api/stack/compose/types";

import { classifyEnvVar } from "@otterdeploy/shared/env-var-kind";
import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import type { TemplateEnvVar } from "../catalog";

/**
 * What the operator will actually have to type for this variable.
 *
 * This column used to print `generateHint` — strings like
 * `openssl rand -base64 32` — which told them to hand-generate a value the
 * wizard fills in two clicks later, on a step whose own copy says secrets are
 * auto-generated. Two surfaces contradicting each other about one value.
 *
 * Both now read `classifyEnvVar`, so this table promises exactly what the
 * seeding code does. `generateHint` survives only as the fallback for keys the
 * platform genuinely cannot fill.
 */
function SuppliedBy({ varKey, generateHint }: { varKey: string; generateHint?: string }) {
  const kind = classifyEnvVar(varKey);
  if (kind === "plain") {
    return (
      <span className="font-mono text-muted-foreground">
        {generateHint ?? "a value you choose"}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {kind === "secret" ? "Generated for you" : "Filled with this stack's address"}
    </span>
  );
}

export function IncludedServicesTable({ parsed }: { parsed: ParsedCompose }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("deployments.columns.service")}</TableHead>
            <TableHead>{t("templates.image")}</TableHead>
            <TableHead>{t("templates.ports")}</TableHead>
            <TableHead>{t("templates.volumes")}</TableHead>
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
  const { t } = useTranslation();
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
            <TableHead>{t("templates.description")}</TableHead>
            <TableHead>You supply</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requiredEnv.map((v) => (
            <TableRow key={v.key}>
              <TableCell className="font-mono text-xs font-medium">{v.key}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{v.description}</TableCell>
              <TableCell className="text-[11px]">
                <SuppliedBy varKey={v.key} generateHint={v.generateHint} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
