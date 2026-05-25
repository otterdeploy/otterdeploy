import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { envCollection } from "@/features/projects/data/env";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { createId, ID_PREFIX, type Slug } from "@otterstack/shared/id";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnvironmentCreateDialog({ projectId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedSlug = slugTouched ? slug : slugify(name);
  const canSubmit = name.trim().length >= 1 && resolvedSlug.length >= 2 && !submitting;

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = createId(ID_PREFIX.environment);
      envCollection.insert({
        id,
        name: name.trim(),
        slug: resolvedSlug,
        projectId: projectId as Slug<typeof ID_PREFIX.project>,
        createdAt: new Date(),
      });
      // Switch the URL to the freshly-created env so the user lands on it.
      void navigate({ search: (prev) => ({ ...prev, env: resolvedSlug }) });
      handleClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create environment");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create environment</DialogTitle>
          <DialogDescription>
            Spin up a new environment to deploy to alongside production.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="env-name">Name</FieldLabel>
            <Input
              id="env-name"
              autoFocus
              placeholder="Staging"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="env-slug">Slug</FieldLabel>
            <Input
              id="env-slug"
              className="font-mono"
              placeholder="staging"
              value={resolvedSlug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </Field>
          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create environment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
