// Step_Variables — environment variables, auto-injected vars, linked secret managers.
// Adapted from local useState to a single variablesField: AnyFieldApi that owns the Var[].
import type { AnyFieldApi } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

// ────────── Var type ──────────
export interface Var {
  key: string;
  value: string;
  secret: boolean;
}

// ────────── LinkedSecrets ──────────
interface LinkedSecrets extends Record<string, boolean> {}

// ────────── Props ──────────
interface StepVariablesProps {
  variablesField: AnyFieldApi;
  linkedSecretsField: AnyFieldApi;
  kind: ServiceKind | null;
}

const SECRET_MANAGERS = [
  { id: "infisical", name: "Infisical", sub: "paperhouse · helio · /apps" },
  { id: "vault", name: "HashiCorp Vault", sub: "vault.paperhouse.dev · kv/helio" },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "us-west-2 · helio/*" },
];

export function StepVariables({ variablesField, linkedSecretsField, kind }: StepVariablesProps) {
  const vars = variablesField.state.value as Var[];
  const linkedSecrets = linkedSecretsField.state.value as LinkedSecrets;

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

      <Card className="mt-2.5 gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[0.06em]">
                Key
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[0.06em]">
                Value
              </TableHead>
              <TableHead className="w-[60px] text-center text-[11px] font-semibold uppercase tracking-[0.06em]">
                Secret
              </TableHead>
              <TableHead className="w-9" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vars.map((v, i) => (
              <TableRow key={i}>
                <TableCell className="py-2">
                  <Input
                    type="text"
                    value={v.key}
                    placeholder="KEY"
                    onChange={(e) => {
                      const next = vars.map((x, j) =>
                        j === i ? { ...x, key: e.target.value } : x,
                      );
                      variablesField.handleChange(next);
                    }}
                    className="h-8 font-mono"
                  />
                </TableCell>
                <TableCell className="py-2">
                  <Input
                    type={v.secret ? "password" : "text"}
                    value={v.value}
                    placeholder={v.secret ? "••••••••" : "value"}
                    onChange={(e) => {
                      const next = vars.map((x, j) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      );
                      variablesField.handleChange(next);
                    }}
                    className="h-8 font-mono"
                  />
                </TableCell>
                <TableCell className="py-2 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={v.secret ? "Mark as plain" : "Mark as secret"}
                    onClick={() => {
                      const next = vars.map((x, j) =>
                        j === i ? { ...x, secret: !x.secret } : x,
                      );
                      variablesField.handleChange(next);
                    }}
                    className={v.secret ? "text-foreground" : "text-muted-foreground"}
                  >
                    <I.lock width={12} height={12} />
                  </Button>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      variablesField.handleChange(vars.filter((_, j) => j !== i));
                    }}
                  >
                    <I.x width={11} height={11} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Add row + import actions */}
        <div className="flex items-center gap-2 border-t bg-muted/50 px-3.5 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              variablesField.handleChange([...vars, { key: "", value: "", secret: false }]);
            }}
          >
            <I.plus width={11} height={11} />
            Add variable
          </Button>
          <Button type="button" variant="outline" size="sm">
            <I.upload width={11} height={11} />
            Upload .env
          </Button>
          <Button type="button" variant="outline" size="sm">
            <I.copy width={11} height={11} />
            Paste from clipboard
          </Button>
          <div className="flex-1" />
          <span className="font-mono text-[11px] text-muted-foreground">
            {vars.length} {vars.length === 1 ? "key" : "keys"}
          </span>
        </div>
      </Card>

      <div className="mt-5">
        <SectionHeader
          title="Linked secret managers"
          sub="Pull secrets from external managers — they sync continuously"
        />
      </div>

      <Card className="mt-2.5 gap-0 divide-y divide-border overflow-hidden p-0">
        {SECRET_MANAGERS.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3.5 py-3">
            <I.lock width={13} height={13} className="text-muted-foreground" />
            <div className="flex-1">
              <div className="text-[13px] font-medium">{p.name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.sub}</div>
            </div>
            <Switch
              checked={!!linkedSecrets[p.id]}
              onCheckedChange={(v) => {
                linkedSecretsField.handleChange({
                  ...linkedSecrets,
                  [p.id]: v,
                });
              }}
            />
          </div>
        ))}
      </Card>
    </>
  );
}
