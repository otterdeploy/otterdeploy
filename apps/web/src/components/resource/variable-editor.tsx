import { useState, useCallback, useRef, useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
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

export function VariableEditor() {
  const [variables, setVariables] = useState<EnvVariable[]>(INITIAL_VARIABLES);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline add/edit state
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    (values: { key: string; value: string; isSecret: boolean; buildTime: boolean }) => {
      setVariables((prev) => [
        { id: crypto.randomUUID(), ...values },
        ...prev,
      ]);
      setIsAdding(false);
    },
    [],
  );

  const handleEditSave = useCallback(
    (id: string, values: { key: string; value: string; isSecret: boolean; buildTime: boolean }) => {
      setVariables((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...values } : v)),
      );
      setEditingId(null);
    },
    [],
  );

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
            <Button size="sm" onClick={startAdding} disabled={isAdding}>
              <PlusIcon />
              Add Variable
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {variables.length === 0 && !isAdding ? (
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
                  const isRevealed = revealedIds.has(variable.id);
                  const isCopied = copiedId === variable.id;
                  const isEditing = editingId === variable.id;

                  if (isEditing) {
                    return (
                      <InlineVariableRow
                        key={variable.id}
                        defaultValues={{
                          key: variable.key,
                          value: variable.value,
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
