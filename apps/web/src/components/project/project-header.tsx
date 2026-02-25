import { useState } from "react";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import { useParams, useNavigate, useMatchRoute, useRouteContext } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from "@/components/ui/tabs";
import { PlusIcon } from "lucide-react";

import { CreateResourcePalette, type ResourceKind } from "./create-resource-palette";

function EnvironmentSwitcher({
  projectId,
  environments,
}: {
  projectId: string;
  environments: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState(environments[0]?.name ?? "production");
  const [showCreate, setShowCreate] = useState(false);
  const zero = useZero();

  const form = useForm({
    defaultValues: {
      name: "",
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Environment name is required").max(64, "Name is too long"),
      }),
    },
    onSubmit: async ({ value }) => {
      const id = crypto.randomUUID();
      const name = value.name;
      if (!name) throw new Error("Environment name is required");
      zero.mutate(
        mutators.environment.create({
          id,
          projectId,
          name,
          now: Date.now(),
        }),
      );
      setShowCreate(false);
      setSelected(name);
      form.reset();
    },
  });

  return (
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
      <Select
        value={selected}
        onValueChange={(val) => {
          if (val === "__create__") {
            setShowCreate(true);
            return;
          }
          if (val) setSelected(val);
        }}
      >
        <SelectTrigger
          size="sm"
          className="border-none bg-transparent shadow-none ring-0 focus-visible:ring-0 gap-1 px-1 text-sm font-medium"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.name}>
              {env.name}
            </SelectItem>
          ))}
          <div className="border-t border-border my-1" />
          <SelectItem value="__create__">
            <PlusIcon className="size-3.5" />
            New environment
          </SelectItem>
        </SelectContent>
      </Select>

      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New environment</DialogTitle>
            <DialogDescription>Create a new environment for this project.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <Input
                    placeholder="e.g. staging"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    autoFocus
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter showCloseButton>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit}>
                  {isSubmitting ? "Creating..." : "Create environment"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const tabs = [
  { label: "Architecture", value: "architecture" },
  { label: "Observability", value: "observability" },
  { label: "Logs", value: "logs" },
  { label: "Settings", value: "settings" },
] as const;

type TabValue = (typeof tabs)[number]["value"];

const basePath = "/dash" as const;
export function ProjectHeader({
  onCreateResource,
  environmentId,
}: {
  onCreateResource: (resource: {
    id: string;
    name: string;
    kind: ResourceKind;
    status: string;
  }) => void;
  environmentId: string;
}) {
  const { auth } = useRouteContext({ from: basePath });

  console.log("ProjectHeader", { environmentId });

  const organizationId = auth.session.activeOrganizationId ?? "";
  const { projectId } = useParams({ from: `${basePath}/projects/$projectId` });
  const navigate = useNavigate();
  const match = useMatchRoute();

  const [project] = useQuery(queries.project.byId({ projectId: projectId }));
  const [environments] = useQuery(queries.environment.list({ projectId: projectId }));
  const [projects] = useQuery(queries.project.list({ organizationId }));

  // Determine the active tab from the current route
  const currentTab = match({ to: `${basePath}/projects/$projectId/settings`, fuzzy: true })
    ? "settings"
    : match({ to: `${basePath}/projects/$projectId/logs`, fuzzy: true })
      ? "logs"
      : match({ to: `${basePath}/projects/$projectId/observability`, fuzzy: true })
        ? "observability"
        : "architecture";

  const handleTabChange = (value: TabValue) => {
    if (!projectId) return;

    const routes: Record<TabValue, string> = {
      architecture: `${basePath}/projects/$projectId/architecture`,
      observability: `${basePath}/projects/$projectId/observability`,
      logs: `${basePath}/projects/$projectId/logs`,
      settings: `${basePath}/projects/$projectId/settings`,
    };
    navigate({
      to: routes[value],
      params: { projectId },
    });
  };

  if (!project) return null;

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border/40 bg-background">
      {/* Left: project + environment */}
      <div className="flex items-center gap-0 px-4">
        <Select
          value={project.id}
          onValueChange={(projectId) => {
            if (!projectId) return;

            navigate({
              to: `${basePath}/projects/$projectId`,
              params: { projectId },
            });
          }}
        >
          <SelectTrigger
            size="sm"
            className="border-none bg-transparent shadow-none ring-0 focus-visible:ring-0 gap-1 px-1 text-sm font-medium"
          >
            <span className="flex flex-1 text-left">{project.name}</span>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="mx-1 text-muted-foreground/40 select-none">/</span>

        <EnvironmentSwitcher projectId={project.id} environments={environments} />
      </div>

      {/* Center: nav tabs */}
      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="ml-auto self-stretch gap-0"
      >
        <TabsList variant="line" className="relative h-full! border-none bg-transparent p-0!">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-full! px-3 py-0! border-transparent! bg-transparent! after:hidden rounded-none"
            >
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsIndicator />
        </TabsList>
      </Tabs>

      {/* Right: new button */}
      <div className="flex items-center gap-2 px-4">
        <CreateResourcePalette onCreated={onCreateResource} environmentId={environmentId} />
      </div>
    </header>
  );
}
