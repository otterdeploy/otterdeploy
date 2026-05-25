import { useFieldContext } from "../form-context";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/shared/components/ui/table";
import { I } from "../icons";

export interface Var {
  key: string;
  value: string;
  secret: boolean;
}

export function VariablesField() {
  const field = useFieldContext<Var[]>();
  const vars = field.state.value;
  return (
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
                    field.handleChange(next);
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
                    field.handleChange(next);
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
                    field.handleChange(next);
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
                    field.handleChange(vars.filter((_, j) => j !== i));
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
            field.handleChange([...vars, { key: "", value: "", secret: false }]);
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
  );
}
