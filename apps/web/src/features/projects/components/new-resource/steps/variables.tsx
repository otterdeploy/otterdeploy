import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

interface StepVariablesProps {
  kind: ServiceKind | null;
}

export function StepVariables({ kind }: StepVariablesProps) {
  const form = useFormContext();

  const suggested =
    !kind || kind.group !== "data"
      ? [
          { k: "NODE_ENV", v: "production", source: "auto" as const },
          { k: "PORT", v: "3000", source: "auto" as const },
          {
            k: "DATABASE_URL",
            v: "postgres://helio:•••@postgres.helio.internal:5432/helio",
            source: "linked" as const,
            from: "postgres",
          },
          {
            k: "REDIS_URL",
            v: "redis://cache.helio.internal:6379",
            source: "linked" as const,
            from: "cache",
          },
        ]
      : [];

  return (
    <>
      <SectionHeader title="Environment variables" sub="Define values to inject at runtime" />

      {suggested.length > 0 && (
        <Card className="mt-3 gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-[11px] font-semibold uppercase tracking-[0.06em]">
                  Auto-injected
                </TableHead>
                <TableHead />
                <TableHead className="text-right">
                  <Badge variant="outline" className="gap-1">
                    <I.bolt width={9} height={9} />
                    otterstack-managed
                  </Badge>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggested.map((s) => (
                <TableRow key={s.k}>
                  <TableCell className="font-mono text-xs font-medium">{s.k}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.v}</TableCell>
                  <TableCell className="text-right">
                    {s.source === "linked" ? (
                      <Badge variant="outline" className="gap-1">
                        <I.link width={9} height={9} />
                        linked · {s.from}
                      </Badge>
                    ) : (
                      <Badge variant="outline">auto</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="mt-5">
        <SectionHeader
          title="Custom variables"
          sub="Add key/value pairs — toggle the lock to mark a value as secret"
        />
      </div>
      <form.AppField name="variables">
        {(f) => <f.VariablesField />}
      </form.AppField>

      <div className="mt-5">
        <SectionHeader
          title="Linked secret managers"
          sub="Pull secrets from external managers — they sync continuously"
        />
      </div>
      <form.AppField name="linkedSecrets">
        {(f) => <f.LinkedSecretsField />}
      </form.AppField>
    </>
  );
}
