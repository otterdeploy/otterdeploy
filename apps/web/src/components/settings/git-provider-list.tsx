import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Delete02Icon, PencilEdit01Icon, Key01Icon } from "@hugeicons/core-free-icons";
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

export function GitProviderList() {
  const organizationId = getOrganizationId() ?? "";
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState("github");
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const providersQuery = useQuery(
    orpc.gitProvider.list.queryOptions({
      input: { organizationId },
      enabled: !!organizationId,
    }),
  );

  const createMutation = useMutation(orpc.gitProvider.create.mutationOptions());
  const deleteMutation = useMutation(orpc.gitProvider.delete.mutationOptions());
  const rotateMutation = useMutation(orpc.gitProvider.rotateSecret.mutationOptions());

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        organizationId,
        type,
        name,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: orpc.gitProvider.list.key() });
      toast.success("Git provider added");
      setDialogOpen(false);
      setName("");
      setClientId("");
      setClientSecret("");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to add git provider"));
    }
  }

  async function handleDelete(providerId: string) {
    try {
      await deleteMutation.mutateAsync({ providerId });
      await queryClient.invalidateQueries({ queryKey: orpc.gitProvider.list.key() });
      toast.success("Git provider removed");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to remove git provider"));
    }
  }

  async function handleRotate(providerId: string) {
    try {
      await rotateMutation.mutateAsync({ providerId, reason: "Manual rotation from UI" });
      await queryClient.invalidateQueries({ queryKey: orpc.gitProvider.list.key() });
      toast.success("Secret rotated");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to rotate secret"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Git Providers</h3>
          <p className="text-sm text-muted-foreground">Connect your Git hosting providers.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
          Add Provider
        </Button>
      </div>

      {providersQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {providersQuery.data && providersQuery.data.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No git providers configured yet.</p>
        </div>
      )}

      {providersQuery.data && providersQuery.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Client ID</TableHead>
              <TableHead>Secrets</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providersQuery.data.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell className="font-medium">{provider.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{provider.type}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{provider.clientId ?? "N/A"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {provider.hasClientSecret && <Badge variant="secondary">Client Secret</Badge>}
                    {provider.hasWebhookSecret && <Badge variant="secondary">Webhook Secret</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleRotate(provider.id)} disabled={rotateMutation.isPending}>
                      <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(provider.id)} disabled={deleteMutation.isPending}>
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
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Add Git Provider</DialogTitle>
              <DialogDescription>Connect a Git hosting provider to your organization.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="gp-name">Name</Label>
                <Input id="gp-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gp-type">Type</Label>
                <Input id="gp-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="github" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gp-client-id">Client ID (optional)</Label>
                <Input id="gp-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gp-client-secret">Client Secret (optional)</Label>
                <Input id="gp-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Provider"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
