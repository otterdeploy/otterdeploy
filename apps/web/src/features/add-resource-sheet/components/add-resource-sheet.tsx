import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ContainerIcon, DatabaseIcon, GitBranchIcon, HardDriveIcon, Share2Icon } from "lucide-react";
import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { client, queryClient } from "@/utils/orpc";
import type { AddResourceKind } from "../types";

type Option = { kind: AddResourceKind; label: string; description: string; icon: typeof DatabaseIcon };

const options: ReadonlyArray<Option> = [
  { kind: "postgres-database", label: "Postgres database", description: "A managed Postgres resource attached to this project.", icon: DatabaseIcon },
  { kind: "github-service", label: "GitHub service", description: "Build and deploy from a GitHub repo. Lands in Plan 4.", icon: GitBranchIcon },
  { kind: "image-service", label: "Image service", description: "Deploy a Docker image. Lands in Plan 4.", icon: ContainerIcon },
  { kind: "volume", label: "Volume", description: "Standalone persistent volume. Lands in Plan 4.", icon: HardDriveIcon },
  { kind: "route", label: "Route", description: "Add a custom domain or layer4 route. Lands in Plan 4.", icon: Share2Icon },
];

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
};

export function AddResourceSheet({ open, onOpenChange, projectId }: Props) {
  const [selected, setSelected] = useState<AddResourceKind | null>(null);
  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetPopup side="right" className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Add to canvas</SheetTitle>
          <SheetDescription>Pick what you want to provision in this project.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 p-4">
          {selected === null ? (
            <ul className="grid gap-2">
              {options.map((option) => {
                const Icon = option.icon;
                return (
                  <li key={option.kind}>
                    <button
                      type="button"
                      onClick={() => setSelected(option.kind)}
                      className="flex w-full items-start gap-3 rounded-lg border bg-card px-3 py-3 text-left hover:bg-accent"
                    >
                      <Icon className="mt-0.5 size-4 text-muted-foreground" />
                      <div className="grid gap-0.5">
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-[11px] text-muted-foreground">{option.description}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : selected === "postgres-database" ? (
            <PostgresForm
              projectId={projectId}
              onCancel={() => setSelected(null)}
              onCreated={() => {
                setSelected(null);
                onOpenChange(false);
              }}
            />
          ) : (
            <Empty>
              <EmptyTitle>{options.find((o) => o.kind === selected)?.label}</EmptyTitle>
              <EmptyDescription>This resource kind lands in Plan 4.</EmptyDescription>
              <Button variant="outline" onClick={() => setSelected(null)} className="mt-3 w-fit">
                Back
              </Button>
            </Empty>
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}

function PostgresForm({ projectId, onCancel, onCreated }: { projectId: string; onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({
    mutationFn: () => client.project.database.createPostgres({ projectId, name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] });
      setName("");
      onCreated();
    },
  });
  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || mutation.isPending) return;
        mutation.mutate();
      }}
      className="grid gap-4"
    >
      <Field>
        <FieldLabel htmlFor="db-name">Database name</FieldLabel>
        <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="primary" />
      </Field>
      {errorMessage ? (
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't create database</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create database"}
        </Button>
      </div>
    </form>
  );
}
