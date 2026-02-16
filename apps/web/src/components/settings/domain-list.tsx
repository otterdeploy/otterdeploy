import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Delete02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@otterstack/ui/components/ui/dialog";
import { Input } from "@otterstack/ui/components/ui/input";
import { Label } from "@otterstack/ui/components/ui/label";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@otterstack/ui/components/ui/table";
import { toast } from "sonner";

import { getOrganizationId, orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

export function DomainList() {
  const organizationId = getOrganizationId() ?? "";
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [resourceId, setResourceId] = useState("");

  const domainsQuery = useQuery(
    orpc.domain.list.queryOptions({
      input: { organizationId },
      enabled: !!organizationId,
    }),
  );

  const addMutation = useMutation(orpc.domain.add.mutationOptions());
  const verifyMutation = useMutation(orpc.domain.verify.mutationOptions());
  const removeMutation = useMutation(orpc.domain.remove.mutationOptions());

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addMutation.mutateAsync({ resourceId, domain });
      await queryClient.invalidateQueries({ queryKey: orpc.domain.list.key() });
      toast.success("Domain added");
      setDialogOpen(false);
      setDomain("");
      setResourceId("");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to add domain"));
    }
  }

  async function handleVerify(domainId: string) {
    try {
      await verifyMutation.mutateAsync({ domainId });
      await queryClient.invalidateQueries({ queryKey: orpc.domain.list.key() });
      toast.success("Domain verification initiated");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to verify domain"));
    }
  }

  async function handleRemove(domainId: string) {
    try {
      await removeMutation.mutateAsync({ domainId });
      await queryClient.invalidateQueries({ queryKey: orpc.domain.list.key() });
      toast.success("Domain removed");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to remove domain"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Domains</h3>
          <p className="text-sm text-muted-foreground">Manage custom domains for your resources.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
          Add Domain
        </Button>
      </div>

      {domainsQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {domainsQuery.data && domainsQuery.data.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No domains configured yet.</p>
        </div>
      )}

      {domainsQuery.data && domainsQuery.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>SSL Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domainsQuery.data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-sm">{d.domain}</TableCell>
                <TableCell>
                  <Badge variant={d.verified ? "default" : "secondary"}>
                    {d.verified ? "Verified" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{d.sslStatus}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(d.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {!d.verified && (
                      <Button variant="ghost" size="icon" onClick={() => handleVerify(d.id)} disabled={verifyMutation.isPending}>
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(d.id)} disabled={removeMutation.isPending}>
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>Add Domain</DialogTitle>
              <DialogDescription>Add a custom domain to a resource.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="domain-name">Domain</Label>
                <Input id="domain-name" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="domain-resource">Resource ID</Label>
                <Input id="domain-resource" value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="Resource ID" required />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Adding..." : "Add Domain"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
