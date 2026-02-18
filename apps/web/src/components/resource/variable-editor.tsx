import { useState, useCallback } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  PlusIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  PencilLineIcon,
  Trash2Icon,
  CheckIcon,
  BracesIcon,
} from "lucide-react";

interface EnvVariable {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  buildTime: boolean;
}

const INITIAL_VARIABLES: EnvVariable[] = [
  {
    id: "1",
    key: "DATABASE_URL",
    value: "postgresql://user:password@localhost:5432/mydb",
    isSecret: true,
    buildTime: false,
  },
  {
    id: "2",
    key: "API_KEY",
    value: "sk-live-abc123def456ghi789",
    isSecret: true,
    buildTime: false,
  },
  {
    id: "3",
    key: "NODE_ENV",
    value: "production",
    isSecret: false,
    buildTime: true,
  },
];

const EMPTY_FORM = { key: "", value: "", isSecret: false, buildTime: false };

export function VariableEditor() {
  const [variables, setVariables] = useState<EnvVariable[]>(INITIAL_VARIABLES);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<EnvVariable | null>(null);

  const toggleReveal = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyValue = useCallback((variable: EnvVariable) => {
    navigator.clipboard.writeText(variable.value);
    setCopiedId(variable.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((variable: EnvVariable) => {
    setEditingId(variable.id);
    setForm({
      key: variable.key,
      value: variable.value,
      isSecret: variable.isSecret,
      buildTime: variable.buildTime,
    });
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.key.trim()) return;

    if (editingId) {
      setVariables((prev) =>
        prev.map((v) =>
          v.id === editingId ? { ...v, ...form } : v,
        ),
      );
    } else {
      setVariables((prev) => [
        ...prev,
        { id: crypto.randomUUID(), ...form },
      ]);
    }

    setDialogOpen(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
  }, [editingId, form]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    setVariables((prev) => prev.filter((v) => v.id !== deleteTarget.id));
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.delete(deleteTarget.id);
      return next;
    });
    setDeleteTarget(null);
  }, [deleteTarget]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>
            Manage environment variables and secrets for this service.
          </CardDescription>
          <CardAction>
            <Button size="sm" onClick={openAddDialog}>
              <PlusIcon />
              Add Variable
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {variables.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BracesIcon />
                </EmptyMedia>
                <EmptyTitle>No variables</EmptyTitle>
                <EmptyDescription>
                  Add environment variables to configure this service.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {variables.map((variable) => {
                  const isRevealed = revealedIds.has(variable.id);
                  const isCopied = copiedId === variable.id;

                  return (
                    <TableRow key={variable.id}>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {variable.key}
                        </code>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {variable.isSecret && !isRevealed
                            ? "••••••••"
                            : variable.value}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {variable.isSecret && (
                            <Badge variant="secondary">Secret</Badge>
                          )}
                          {variable.buildTime && (
                            <Badge variant="outline">Build</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          {variable.isSecret && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => toggleReveal(variable.id)}
                                  />
                                }
                              >
                                {isRevealed ? (
                                  <EyeOffIcon className="size-3.5" />
                                ) : (
                                  <EyeIcon className="size-3.5" />
                                )}
                              </TooltipTrigger>
                              <TooltipContent>
                                {isRevealed ? "Hide value" : "Reveal value"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => copyValue(variable)}
                                />
                              }
                            >
                              {isCopied ? (
                                <CheckIcon className="size-3.5" />
                              ) : (
                                <CopyIcon className="size-3.5" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {isCopied ? "Copied!" : "Copy value"}
                            </TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                />
                              }
                            >
                              <EllipsisVerticalIcon className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openEditDialog(variable)}
                              >
                                <PencilLineIcon />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteTarget(variable)}
                              >
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Variable" : "Add Variable"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the environment variable for this service."
                : "Add a new environment variable to this service."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="var-key">Key</Label>
              <Input
                id="var-key"
                placeholder="e.g. DATABASE_URL"
                className="font-mono"
                value={form.key}
                onChange={(e) =>
                  setForm((f) => ({ ...f, key: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="var-value">Value</Label>
              <Textarea
                id="var-value"
                placeholder="Enter value..."
                className="font-mono"
                value={form.value}
                onChange={(e) =>
                  setForm((f) => ({ ...f, value: e.target.value }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="grid gap-0.5">
                <Label htmlFor="var-secret">Secret</Label>
                <p className="text-xs text-muted-foreground">
                  Mask the value and encrypt at rest.
                </p>
              </div>
              <Switch
                id="var-secret"
                checked={form.isSecret}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, isSecret: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="grid gap-0.5">
                <Label htmlFor="var-build">Build Time</Label>
                <p className="text-xs text-muted-foreground">
                  Available during the build step.
                </p>
              </div>
              <Switch
                id="var-build"
                checked={form.buildTime}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, buildTime: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.key.trim()}>
              {editingId ? "Save Changes" : "Add Variable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete variable</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <code className="font-mono text-foreground">
                {deleteTarget?.key}
              </code>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
