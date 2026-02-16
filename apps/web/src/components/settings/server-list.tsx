import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Delete02Icon, TestTube01Icon } from "@hugeicons/core-free-icons";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@otterstack/ui/components/ui/native-select";
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

export function ServerList() {
  const organizationId = getOrganizationId() ?? "";
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState("22");
  const [role, setRole] = useState<"manager" | "worker">("worker");

  const serversQuery = useQuery(
    orpc.server.list.queryOptions({
      input: { organizationId },
      enabled: !!organizationId,
    }),
  );

  const registerMutation = useMutation(orpc.server.register.mutationOptions());
  const testMutation = useMutation(orpc.server.test.mutationOptions());
  const removeMutation = useMutation(orpc.server.remove.mutationOptions());

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerMutation.mutateAsync({
        organizationId,
        name,
        ipAddress,
        port: Number(port),
        role,
      });
      await queryClient.invalidateQueries({ queryKey: orpc.server.list.key() });
      toast.success("Server registered");
      setDialogOpen(false);
      setName("");
      setIpAddress("");
      setPort("22");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to register server"));
    }
  }

  async function handleTest(serverId: string) {
    try {
      const result = await testMutation.mutateAsync({ serverId });
      toast.success(`Status: ${result.status}${result.roundTripMs != null ? ` (${result.roundTripMs}ms)` : ""}`);
    } catch (error) {
      toast.error(toUserMessage(error, "Test connection failed"));
    }
  }

  async function handleRemove(serverId: string) {
    try {
      await removeMutation.mutateAsync({ serverId });
      await queryClient.invalidateQueries({ queryKey: orpc.server.list.key() });
      toast.success("Server removed");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to remove server"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Servers</h3>
          <p className="text-sm text-muted-foreground">Manage your infrastructure servers.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
          Register Server
        </Button>
      </div>

      {serversQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {serversQuery.data && serversQuery.data.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No servers registered yet.</p>
        </div>
      )}

      {serversQuery.data && serversQuery.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {serversQuery.data.map((server) => (
              <TableRow key={server.id}>
                <TableCell className="font-medium">{server.name}</TableCell>
                <TableCell className="font-mono text-sm">{server.ipAddress}</TableCell>
                <TableCell>{server.port}</TableCell>
                <TableCell>
                  <Badge variant="outline">{server.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={server.status === "connected" ? "default" : "secondary"}>
                    {server.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleTest(server.id)}
                      disabled={testMutation.isPending}
                    >
                      <HugeiconsIcon icon={TestTube01Icon} strokeWidth={2} className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(server.id)}
                      disabled={removeMutation.isPending}
                    >
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
          <form onSubmit={handleRegister}>
            <DialogHeader>
              <DialogTitle>Register Server</DialogTitle>
              <DialogDescription>Add a new server to your infrastructure.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="server-name">Name</Label>
                <Input id="server-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="server-ip">IP Address</Label>
                <Input id="server-ip" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="server-port">Port</Label>
                <Input id="server-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="server-role">Role</Label>
                <NativeSelect id="server-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <NativeSelectOption value="worker">Worker</NativeSelectOption>
                  <NativeSelectOption value="manager">Manager</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "Registering..." : "Register"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
