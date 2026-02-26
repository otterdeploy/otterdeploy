import { useState, useCallback, useRef, useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery as useTanstackQuery } from "@tanstack/react-query";
import * as z from "zod";
import { orpc, queryClient } from "@/utils/orpc";
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
import { Badge } from "@/components/ui/badge";
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
  XIcon,
  BracesIcon,
  LoaderIcon,
} from "lucide-react";
import { toast } from "sonner";

interface EnvVariable {
  id: string;
  key: string;
  isSecret: boolean;
  buildTime: boolean;
  value: string | null;
}

const envVariableSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string(),
  isSecret: z.boolean(),
  buildTime: z.boolean(),
});

function InlineVariableRow({
  defaultValues,
  onSave,
  onCancel,
  autoFocus,
}: {
  defaultValues: { key: string; value: string; isSecret: boolean; buildTime: boolean };
  onSave: (values: { key: string; value: string; isSecret: boolean; buildTime: boolean }) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const keyInputRef = useRef<HTMLInputElement>(null);

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: envVariableSchema,
    },
    onSubmit: ({ value }) => {
      onSave(value);
    },
  });

  useEffect(() => {
    if (autoFocus) {
      keyInputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      form.handleSubmit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <TableRow>
      <TableCell>
        <form.Field name="key">
          {(field) => (
            <Input
              ref={keyInputRef}
              placeholder="KEY"
              className="font-mono text-xs h-8"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          )}
        </form.Field>
      </TableCell>
      <TableCell>
        <form.Field name="value">
          {(field) => (
            <Input
              placeholder="Value"
              className="font-mono text-xs h-8"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          )}
        </form.Field>
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <form.Field name="isSecret">
            {(field) => (
              <button
                type="button"
                onClick={() => field.handleChange(!field.state.value)}
              >
                <Badge
                  variant={field.state.value ? "secondary" : "outline"}
                  className={field.state.value ? "" : "opacity-40"}
                >
                  Secret
                </Badge>
              </button>
            )}
          </form.Field>
          <form.Field name="buildTime">
            {(field) => (
              <button
                type="button"
                onClick={() => field.handleChange(!field.state.value)}
              >
                <Badge
                  variant="outline"
                  className={field.state.value ? "" : "opacity-40"}
                >
                  Build
                </Badge>
              </button>
            )}
          </form.Field>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-0.5">
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => form.handleSubmit()}
                      disabled={!canSubmit}
                    />
                  }
                >
                  <CheckIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Save</TooltipContent>
              </Tooltip>
            )}
          </form.Subscribe>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={onCancel}
                />
              }
            >
              <XIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface VariableEditorProps {
  resourceId: string;
  projectId: string;
  environmentId?: string;
}

export function VariableEditor({
  resourceId,
  projectId,
  environmentId,
}: VariableEditorProps) {
  const listQueryOptions = orpc.environmentVariable.list.queryOptions({
    input: { projectId, environmentId, resourceId },
  });

  const { data: variables = [], isLoading } = useTanstackQuery(listQueryOptions);

  const [revealedValues, setRevealedValues] = useState<Map<string, string>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline add/edit state
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<EnvVariable | null>(null);

  const invalidateList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey });
  }, [listQueryOptions.queryKey]);

  const upsertVariable = useMutation(orpc.environmentVariable.upsert.mutationOptions());
  const deleteVariable = useMutation(orpc.environmentVariable.delete.mutationOptions());
  const revealVariable = useMutation(orpc.environmentVariable.reveal.mutationOptions());

  const toggleReveal = useCallback(async (variable: EnvVariable) => {
    if (revealedValues.has(variable.id)) {
      setRevealedValues((prev) => {
        const next = new Map(prev);
        next.delete(variable.id);
        return next;
      });
      return;
    }

    try {
      const result = await revealVariable.mutateAsync({
        variableId: variable.id,
        reason: "Revealed from dashboard",
      });
      setRevealedValues((prev) => {
        const next = new Map(prev);
        next.set(variable.id, (result as { value: string }).value);
        return next;
      });
    } catch (err) {
      toast.error(`Failed to reveal: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [revealedValues, revealVariable]);

  const copyValue = useCallback(async (variable: EnvVariable) => {
    try {
      const cached = revealedValues.get(variable.id);
      let value: string;
      if (cached) {
        value = cached;
      } else if (!variable.isSecret && variable.value !== null) {
        value = variable.value;
      } else {
        const result = await revealVariable.mutateAsync({
          variableId: variable.id,
          reason: "Copied from dashboard",
        });
        value = (result as { value: string }).value;
      }
      navigator.clipboard.writeText(value);
      setCopiedId(variable.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      toast.error(`Failed to copy: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [revealedValues, revealVariable]);

  const startAdding = useCallback(() => {
    setEditingId(null);
    setIsAdding(true);
  }, []);

  const startEditing = useCallback((variable: EnvVariable) => {
    setIsAdding(false);
    setEditingId(variable.id);
  }, []);

  const cancelInline = useCallback(() => {
    setIsAdding(false);
    setEditingId(null);
  }, []);

  const handleAddSave = useCallback(
    async (values: { key: string; value: string; isSecret: boolean; buildTime: boolean }) => {
      try {
        if (!environmentId) {
          toast.error("Environment context is missing for this resource");
          return;
        }
        await upsertVariable.mutateAsync({
          projectId,
          environmentId,
          resourceId,
          scope: "resource",
          key: values.key,
          value: values.value,
          isSecret: values.isSecret,
          buildTime: values.buildTime,
        });
        setIsAdding(false);
        invalidateList();
      } catch (err) {
        toast.error(`Failed to add variable: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [projectId, environmentId, resourceId, upsertVariable, invalidateList],
  );

  const handleEditSave = useCallback(
    async (id: string, values: { key: string; value: string; isSecret: boolean; buildTime: boolean }) => {
      try {
        if (!environmentId) {
          toast.error("Environment context is missing for this resource");
          return;
        }
        await upsertVariable.mutateAsync({
          projectId,
          environmentId,
          resourceId,
          scope: "resource",
          key: values.key,
          value: values.value,
          isSecret: values.isSecret,
          buildTime: values.buildTime,
        });
        setEditingId(null);
        setRevealedValues((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        invalidateList();
      } catch (err) {
        toast.error(`Failed to update variable: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [projectId, environmentId, resourceId, upsertVariable, invalidateList],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteVariable.mutateAsync({ variableId: deleteTarget.id });
      setRevealedValues((prev) => {
        const next = new Map(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
      invalidateList();
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteVariable, invalidateList]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>
            Manage environment variables and secrets for this service.
          </CardDescription>
          <CardAction>
            <Button size="sm" onClick={startAdding} disabled={isAdding}>
              <PlusIcon />
              Add Variable
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin mr-2" />
              Loading variables...
            </div>
          ) : variables.length === 0 && !isAdding ? (
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
                {isAdding && (
                  <InlineVariableRow
                    defaultValues={{ key: "", value: "", isSecret: false, buildTime: false }}
                    onSave={handleAddSave}
                    onCancel={cancelInline}
                    autoFocus
                  />
                )}
                {variables.map((variable) => {
                  const revealedValue = revealedValues.get(variable.id);
                  const isRevealed = !!revealedValue;
                  const isCopied = copiedId === variable.id;
                  const isEditing = editingId === variable.id;

                  if (isEditing) {
                    return (
                      <InlineVariableRow
                        key={variable.id}
                        defaultValues={{
                          key: variable.key,
                          value: revealedValue ?? variable.value ?? "",
                          isSecret: variable.isSecret,
                          buildTime: variable.buildTime,
                        }}
                        onSave={(values) => handleEditSave(variable.id, values)}
                        onCancel={cancelInline}
                        autoFocus
                      />
                    );
                  }

                  return (
                    <TableRow key={variable.id}>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {variable.key}
                        </code>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {isRevealed
                            ? revealedValue
                            : variable.isSecret
                              ? "••••••••"
                              : (variable.value ?? "")}
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
                                    onClick={() => toggleReveal(variable)}
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
                                onClick={() => startEditing(variable)}
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
