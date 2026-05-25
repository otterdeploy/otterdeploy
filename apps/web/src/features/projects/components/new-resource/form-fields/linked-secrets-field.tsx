import { useFieldContext } from "../form-context";
import { Card } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";
import { I } from "../icons";

const SECRET_MANAGERS = [
  { id: "infisical", name: "Infisical", sub: "paperhouse · helio · /apps" },
  { id: "vault", name: "HashiCorp Vault", sub: "vault.paperhouse.dev · kv/helio" },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "us-west-2 · helio/*" },
];

export function LinkedSecretsField() {
  const field = useFieldContext<Record<string, boolean>>();
  const value = field.state.value;
  return (
    <Card className="mt-2.5 gap-0 divide-y divide-border overflow-hidden p-0">
      {SECRET_MANAGERS.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-3.5 py-3">
          <I.lock width={13} height={13} className="text-muted-foreground" />
          <div className="flex-1">
            <div className="text-[13px] font-medium">{p.name}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.sub}</div>
          </div>
          <Switch
            checked={!!value[p.id]}
            onCheckedChange={(v) => field.handleChange({ ...value, [p.id]: v })}
          />
        </div>
      ))}
    </Card>
  );
}
