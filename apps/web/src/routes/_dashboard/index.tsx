import { envCollection } from "@/features/environment-switcher/api";
import { useInvalidationSocket } from "@/hooks/use-invalidation-socket";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,
});

function RouteComponent() {
  useInvalidationSocket("env");
  const { data, isError } = useLiveQuery(envCollection);
  const [open, setOpen] = useState(false);

  if (isError) {
    return <div>Error Occured</div>;
  }

  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
    },
    onSubmit: ({ value }) => {
      console.log("first", value);
      envCollection.insert({ id: crypto.randomUUID(), ...value });
      setOpen(false);
    },
    validators: {
      onSubmit: z.object({
        name: z.string(),
        slug: z.string(),
      }),
    },
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Environments</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <PlusIcon />
            New Environment
          </DialogTrigger>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Create Environment</DialogTitle>
              <DialogDescription>Add a new environment to your project.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="space-y-4 p-6 pt-0"
            >
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="env-name">Name</Label>
                    <Input
                      id="env-name"
                      placeholder="e.g. Staging"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      required
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="slug">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="env-slug">Slug</Label>
                    <Input
                      id="env-slug"
                      placeholder="e.g. staging"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      required
                    />
                  </div>
                )}
              </form.Field>
              <DialogFooter variant="bare">
                <Button type="submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogPopup>
        </Dialog>
      </div>

      <ul className="space-y-1">
        {data.map((d) => (
          <li key={d.id}>{d.slug}</li>
        ))}
      </ul>
    </div>
  );
}
