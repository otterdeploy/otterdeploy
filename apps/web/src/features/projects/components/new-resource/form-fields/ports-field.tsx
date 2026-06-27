import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import { useFieldContext } from "../form-context";
import { I } from "../icons";

export interface Port {
  port: number;
  protocol: string;
  public: boolean;
  host: string;
}

const PROTOCOLS = [
  { value: "http", label: "HTTP" },
  { value: "http2", label: "HTTP/2" },
  { value: "grpc", label: "gRPC" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const PORTS_GRID = "grid grid-cols-[80px_100px_1fr_70px_50px] items-center gap-2";

export function PortsField() {
  const field = useFieldContext<Port[]>();
  const ports = field.state.value;
  return (
    <Card className="mt-3 gap-0 overflow-hidden rounded-md p-0">
      <div
        className={cn(
          PORTS_GRID,
          "border-b bg-muted/50 px-3.5 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase",
        )}
      >
        <span>Port</span>
        <span>Protocol</span>
        <span>Public hostname</span>
        <span>Public</span>
        <span />
      </div>
      {ports.map((p, i) => (
        <div
          key={i}
          className={cn(
            PORTS_GRID,
            "px-3.5 py-2",
            i === ports.length - 1 ? "" : "border-b border-border/60",
          )}
        >
          <Input
            className="font-mono"
            type="number"
            value={p.port}
            onChange={(e) => {
              const next = ports.map((x, j) => (j === i ? { ...x, port: +e.target.value } : x));
              field.handleChange(next);
            }}
          />
          <Select
            value={p.protocol}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              const next = ports.map((x, j) => (j === i ? { ...x, protocol: v } : x));
              field.handleChange(next);
            }}
            items={PROTOCOLS}
          >
            <SelectTrigger className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOLS.map((proto) => (
                <SelectItem key={proto.value} value={proto.value}>
                  {proto.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className={cn("font-mono", !p.public && "opacity-50")}
            value={p.host}
            onChange={(e) => {
              const next = ports.map((x, j) => (j === i ? { ...x, host: e.target.value } : x));
              field.handleChange(next);
            }}
            disabled={!p.public}
          />
          <Switch
            checked={p.public}
            onCheckedChange={(v) => {
              const next = ports.map((x, j) => (j === i ? { ...x, public: v } : x));
              field.handleChange(next);
            }}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => field.handleChange(ports.filter((_, j) => j !== i))}
              aria-label="Remove port"
            >
              <I.x width={11} height={11} />
            </Button>
          </div>
        </div>
      ))}
      <div className="px-3.5 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            field.handleChange([
              ...ports,
              { port: 8080, protocol: "http", public: false, host: "" },
            ]);
          }}
        >
          <I.plus width={11} height={11} />
          Add port
        </Button>
      </div>
    </Card>
  );
}
