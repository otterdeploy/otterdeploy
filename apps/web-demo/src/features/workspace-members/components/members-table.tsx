import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { authClient } from "@/lib/auth";
import type { MemberRow } from "../types";

export function MembersTable() {
  const session = authClient.useSession();

  if (session.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  const me = session.data?.user;
  const rows: MemberRow[] = me
    ? [
        {
          id: me.id,
          name: me.name,
          email: me.email,
          role: "owner",
        },
      ]
    : [];

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="sm" disabled>
                + Invite
              </Button>
            }
          />
          <TooltipPopup>RBAC + invitations ship in Plan 6</TooltipPopup>
        </Tooltip>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="size-6 rounded">
                    <AvatarFallback className="text-[10px]">
                      {row.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{row.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {row.email}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {row.role}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
