import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@otterstack/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@otterstack/ui/components/ui/dialog";
import { Input } from "@otterstack/ui/components/ui/input";
import { Label } from "@otterstack/ui/components/ui/label";
import { toast } from "sonner";

import { getOrganizationId, orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

type CreateProjectDialogProps = {
  children: React.ReactNode;
};

export function CreateProjectDialog({ children }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation(orpc.project.create.mutationOptions());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const organizationId = getOrganizationId();
    if (!organizationId) {
      toast.error("No organization selected");
      return;
    }

    try {
      await createMutation.mutateAsync({
        organizationId,
        name,
        ...(slug ? { slug } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: orpc.project.list.key() });
      toast.success("Project created");
      setOpen(false);
      setName("");
      setSlug("");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to create project"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<>{children}</>} />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Add a new project to your organization.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-slug">Slug (optional)</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-project"
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens. Auto-generated if empty.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
