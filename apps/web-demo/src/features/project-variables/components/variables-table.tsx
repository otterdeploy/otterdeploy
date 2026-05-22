import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { VariableScope } from "../types";

type Props = {
  scope: VariableScope;
};

export function VariablesTable({ scope }: Props) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" variant="outline" disabled>Bulk import</Button>} />
          <TooltipPopup>Paste a .env file when the variables API ships (Plan 6)</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" disabled>+ Add variable</Button>} />
          <TooltipPopup>Variable CRUD ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Referenced by</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Rows render here when project.variable.list ships in Plan 6 */}
        </TableBody>
      </Table>

      <Empty>
        <KeyRoundIcon className="size-6" />
        <EmptyTitle>No variables yet</EmptyTitle>
        <EmptyDescription>
          {scope === "project"
            ? "Shared env vars become referenceable from any service via ${shared.X}. Backend ships in Plan 6."
            : "Resource-scoped env vars override shared ones. Backend ships in Plan 6."}
        </EmptyDescription>
      </Empty>
    </div>
  );
}
