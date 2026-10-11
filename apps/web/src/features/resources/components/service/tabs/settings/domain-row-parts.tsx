/**
 * The editing pieces of one domain row: the target-port picker and the inline
 * edit row. The row's actions live in ./domain-row-actions and its status in
 * ./domain-status-card. All stateless; handlers and busy flags come in as props.
 */

import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";

/** The container ports a host may be routed at. Empty means the service
 *  declares none: the caller hides the picker rather than offering nothing. */
export interface PortChoice {
  containerPort: number;
  appProtocol: "http" | "tcp";
  isPrimary: boolean;
}

/** Which container port a domain forwards to. A single-port service gets a
 *  plain label: a dropdown with one option is a question with one answer. */
export function PortPicker({
  value,
  ports,
  onChange,
  disabled,
  id,
}: {
  value: number | undefined;
  ports: PortChoice[];
  onChange: (port: number) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useTranslation();
  if (ports.length <= 1) {
    const only = ports[0]?.containerPort ?? value;
    return (
      <div
        className="flex h-8 items-center rounded-md border border-input bg-muted/30 px-2.5 font-mono text-[12.5px] text-muted-foreground"
        aria-label={t("domains.targetPort")}
      >
        {only != null ? `:${only}` : t("domains.noPublishedPort")}
      </div>
    );
  }
  const items = ports.map((p) => ({
    value: String(p.containerPort),
    label: `${p.containerPort}${p.appProtocol === "tcp" ? " (tcp)" : ""}`,
  }));
  return (
    <Select
      items={items}
      value={value != null ? String(value) : null}
      disabled={disabled}
      onValueChange={(v) => {
        if (typeof v !== "string") return;
        const port = ports.find((p) => String(p.containerPort) === v);
        if (port) onChange(port.containerPort);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={t("domains.targetPort")}
        className="h-8 font-mono text-[12.5px]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value} className="font-mono text-[12.5px]">
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DomainEditRow({
  value,
  onChange,
  onSave,
  saving,
  onCancel,
  port,
  ports,
  onPortChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onCancel: () => void;
  port: number;
  ports: PortChoice[];
  onPortChange: (port: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          // Enter commits, same as the add form's submit. Without this the
          // universal "type, press Enter" gesture silently discarded the edit.
          if (e.key === "Enter" && !saving && value.trim().length > 0) onSave();
        }}
        className="h-8 min-w-0 flex-1 basis-48 font-mono text-[12.5px]"
        spellCheck={false}
        autoCapitalize="off"
        aria-label={t("domains.domain")}
      />
      <PortPicker value={port} ports={ports} onChange={onPortChange} disabled={saving} />
      <Button size="sm" onClick={onSave} disabled={saving || value.trim().length === 0}>
        {saving ? <Spinner className="size-3.5" /> : t("common.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
