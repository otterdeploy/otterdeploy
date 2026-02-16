import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@otterstack/ui/components/ui/table";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import { RoleBadge } from "./role-badge";

type Member = {
  id: string;
  userId: string;
  role: string;
  user: {
    name: string;
    email: string;
  };
};

type MemberListProps = {
  members: Member[];
};

export function MemberList({ members }: MemberListProps) {
  if (members.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No team members yet.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="w-20">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">{member.user.name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{member.user.email}</TableCell>
            <TableCell>
              <RoleBadge role={member.role} />
            </TableCell>
            <TableCell>
              {member.role !== "owner" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    try {
                      await authClient.organization.removeMember({
                        memberIdOrEmail: member.userId,
                      });
                      toast.success("Member removed");
                    } catch {
                      toast.error("Failed to remove member");
                    }
                  }}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
