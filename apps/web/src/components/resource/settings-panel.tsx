import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Alert01Icon,
  AlertCircleIcon,
  ArrowUpRight01Icon,
  DocumentCodeIcon,
  GlobeIcon,
  PlusSignIcon,
  Refresh01Icon,
  Settings01Icon,
  SourceCodeIcon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery as useTanstackQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Section IDs
// ---------------------------------------------------------------------------

const SECTION_IDS = [
  "source",
  "networking",
  "scale",
  "build",
  "deploy",
  "config-as-code",
  "danger",
] as const;

const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  source: "Source",
  networking: "Networking",
  scale: "Scale",
  build: "Build",
  deploy: "Deploy",
  "config-as-code": "Config-as-code",
  danger: "Danger",
};

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function DocsLink({ href = "#", children = "Docs" }: { href?: string; children?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
    >
      {children}
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
    </a>
  );
}

function SettingField({
  label,
  description,
  docsHref,
  children,
}: {
  label: string;
  description?: string;
  docsHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{label}</h4>
        {description && (
          <p className="text-sm text-muted-foreground">
            {description}
            {docsHref && (
              <>
                {" "}
                <DocsLink href={docsHref} />
              </>
            )}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="bg-card ring-foreground/10 flex items-center gap-3 rounded-lg px-4 py-3 ring-1">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function InfoRow({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="bg-card ring-foreground/10 flex items-center gap-3 rounded-lg px-4 py-3 ring-1">
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

function SectionHeader({
  id,
  icon,
  title,
  variant = "default",
}: {
  id?: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  title: string;
  variant?: "default" | "danger";
}) {
  return (
    <div id={id} className="flex items-center gap-3 scroll-mt-4">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          variant === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <HugeiconsIcon icon={icon} size={16} />
      </div>
      <h3
        className={`text-base font-medium ${variant === "danger" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {title}
      </h3>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Source (placeholder — not yet in API)
// ---------------------------------------------------------------------------

function SourceSection() {
  return (
    <section className="space-y-6">
      <SectionHeader id="source" icon={SourceCodeIcon} title="Source" />
      <div className="space-y-6 pl-11">
        <p className="text-sm text-muted-foreground">
          Source configuration is not yet available. Connect a Git repository to enable source-based deployments.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Networking (placeholder — not yet in API)
// ---------------------------------------------------------------------------

function NetworkingSection() {
  return (
    <section className="space-y-6">
      <SectionHeader id="networking" icon={Wifi01Icon} title="Networking" />
      <div className="space-y-6 pl-11">
        <p className="text-sm text-muted-foreground">
          Networking configuration is not yet available. Public domains and private networking will be configurable here.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Scale
// ---------------------------------------------------------------------------

function ScaleSection({
  resourceId,
  replicas,
  port,
  onSave,
  saving,
}: {
  resourceId: string;
  replicas: number | null;
  port: number | null;
  onSave: (data: { replicas?: number; port?: number }) => void;
  saving: boolean;
}) {
  const form = useForm({
    defaultValues: {
      replicas: String(replicas ?? 1),
      port: String(port ?? ""),
      cpuLimit: 8,
      memoryLimit: 8,
    },
    onSubmit: ({ value }) => {
      onSave({
        replicas: value.replicas ? Number(value.replicas) : undefined,
        port: value.port ? Number(value.port) : undefined,
      });
    },
  });

  return (
    <section className="space-y-6">
      <SectionHeader id="scale" icon={GlobeIcon} title="Scale" />
      <div className="space-y-6 pl-11">
        <SettingField label="Port" description="The port your application listens on.">
          <form.Field name="port">
            {(field) => (
              <Input
                type="number"
                placeholder="e.g. 3000"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                className="w-32"
              />
            )}
          </form.Field>
        </SettingField>

        <SettingField
          label="Replicas"
          description="Number of instances to run for horizontal scaling."
        >
          <form.Field name="replicas">
            {(field) => (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  className="w-16 text-center"
                />
                <span className="text-sm text-muted-foreground">
                  Replica{Number(field.state.value) !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </form.Field>
        </SettingField>

        <SettingField
          label="Replica Limits"
          description="Allocate a maximum vCPU and Memory for each replica."
        >
          <div className="bg-card ring-foreground/10 space-y-4 rounded-lg p-4 ring-1">
            <form.Field name="cpuLimit">
              {(field) => (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      CPU: <strong>{field.state.value} vCPU</strong>
                    </span>
                    <span className="text-muted-foreground">Plan limit: 8 vCPU</span>
                  </div>
                  <Slider
                    value={[field.state.value]}
                    onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                    min={0.5}
                    max={8}
                    step={0.5}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="memoryLimit">
              {(field) => (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      Memory: <strong>{field.state.value} GB</strong>
                    </span>
                    <span className="text-muted-foreground">Plan limit: 8 GB</span>
                  </div>
                  <Slider
                    value={[field.state.value]}
                    onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                    min={0.5}
                    max={8}
                    step={0.5}
                  />
                </div>
              )}
            </form.Field>
          </div>
        </SettingField>

        <Button
          size="sm"
          disabled={saving}
          onClick={() => form.handleSubmit()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Build
// ---------------------------------------------------------------------------

function BuildSection({
  builder,
  dockerfilePath,
  onSave,
  saving,
}: {
  builder: string | null;
  dockerfilePath: string | null;
  onSave: (data: { builder?: "nixpacks" | "dockerfile" | "buildpack"; dockerfilePath?: string }) => void;
  saving: boolean;
}) {
  const form = useForm({
    defaultValues: {
      builder: builder ?? "nixpacks",
      dockerfilePath: dockerfilePath ?? "",
    },
    onSubmit: ({ value }) => {
      onSave({
        builder: value.builder as "nixpacks" | "dockerfile" | "buildpack",
        dockerfilePath: value.dockerfilePath || undefined,
      });
    },
  });

  return (
    <section className="space-y-6">
      <SectionHeader id="build" icon={Settings01Icon} title="Build" />
      <div className="space-y-6 pl-11">
        <SettingField label="Builder" description="How to build your application.">
          <form.Field name="builder">
            {(field) => (
              <Select value={field.state.value} onValueChange={(v) => { if (v) field.handleChange(v); }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nixpacks">Nixpacks</SelectItem>
                  <SelectItem value="dockerfile">Dockerfile</SelectItem>
                  <SelectItem value="buildpack">Buildpack</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </SettingField>

        <SettingField label="Dockerfile Path" description="Path to your Dockerfile relative to the root.">
          <form.Field name="dockerfilePath">
            {(field) => (
              <Input
                placeholder="e.g. /docker/Dockerfile"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        </SettingField>

        <Button
          size="sm"
          disabled={saving}
          onClick={() => form.handleSubmit()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Deploy
// ---------------------------------------------------------------------------

function DeploySection({
  healthCheckPath,
  onSave,
  saving,
}: {
  healthCheckPath: string | null;
  onSave: (data: { healthCheckPath?: string }) => void;
  saving: boolean;
}) {
  const form = useForm({
    defaultValues: {
      teardown: false,
      serverless: false,
      restartPolicy: "on-failure",
      maxRetries: "10",
      healthCheckPath: healthCheckPath ?? "",
    },
    onSubmit: ({ value }) => {
      onSave({
        healthCheckPath: value.healthCheckPath || undefined,
      });
    },
  });

  return (
    <section className="space-y-6">
      <SectionHeader id="deploy" icon={Refresh01Icon} title="Deploy" />
      <div className="space-y-6 pl-11">
        <SettingField
          label="Custom Start Command"
          description="Command that will be run to start new deployments."
          docsHref="#"
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Start Command
          </Button>
        </SettingField>

        <SettingField
          label="Teardown"
          description="Configure old deployment termination when a new one is started."
          docsHref="#"
        >
          <form.Field name="teardown">
            {(field) => (
              <SwitchRow
                label="Enable Teardown"
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            )}
          </form.Field>
        </SettingField>

        <SettingField
          label="Cron Schedule"
          description="Run the service according to the specified cron schedule."
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Add Schedule
          </Button>
        </SettingField>

        <SettingField
          label="Healthcheck Path"
          description="Endpoint to be called before a deploy completes to ensure the new deployment is live."
          docsHref="#"
        >
          <form.Field name="healthCheckPath">
            {(field) => (
              <Input
                placeholder="e.g. /health"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        </SettingField>

        <SettingField
          label="Serverless"
          description="Containers will scale down to zero and then scale up based on traffic."
          docsHref="#"
        >
          <form.Field name="serverless">
            {(field) => (
              <SwitchRow
                label="Enable Serverless"
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            )}
          </form.Field>
        </SettingField>

        <SettingField
          label="Restart Policy"
          description="Configure what to do when the process exits."
          docsHref="#"
        >
          <form.Field name="restartPolicy">
            {(field) => (
              <Select
                value={field.state.value}
                onValueChange={(v) => {
                  if (v) field.handleChange(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="always">Always</SelectItem>
                  <SelectItem value="on-failure">On Failure</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Number of times to try and restart the service if it stopped due to an error.
            </p>
            <form.Field name="maxRetries">
              {(field) => (
                <Input
                  type="number"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
          </div>
        </SettingField>

        <Button
          size="sm"
          disabled={saving}
          onClick={() => form.handleSubmit()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Config-as-code
// ---------------------------------------------------------------------------

function ConfigSection() {
  return (
    <section className="space-y-6">
      <SectionHeader id="config-as-code" icon={DocumentCodeIcon} title="Config-as-code" />
      <div className="space-y-6 pl-11">
        <SettingField
          label="Config File"
          description="Manage your build and deployment settings through a config file."
          docsHref="#"
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Add File Path
          </Button>
        </SettingField>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Danger
// ---------------------------------------------------------------------------

function DangerSection({
  resourceId,
  resourceName,
}: {
  resourceId: string;
  resourceName: string;
}) {
  const { projectId } = useParams({ strict: false });
  const navigate = useNavigate();
  const deleteResource = useMutation(orpc.resource.delete.mutationOptions());

  const handleDelete = async () => {
    try {
      await deleteResource.mutateAsync({ resourceId });
      toast.success(`"${resourceName}" has been deleted`);
      if (projectId) {
        navigate({ to: "/dash/projects/$projectId/architecture", params: { projectId } });
      }
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <section className="space-y-4">
      <SectionHeader id="danger" icon={Alert01Icon} title="Delete Service" variant="danger" />
      <div className="space-y-3 pl-11">
        <p className="text-sm text-muted-foreground">
          Deleting this service will{" "}
          <strong className="text-foreground">permanently delete</strong> all its deployments and
          remove it from <strong className="text-foreground">this environment</strong>. This cannot
          be undone.
        </p>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            Delete service
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{resourceName}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all deployments and configuration for this service. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteResource.isPending}
              >
                {deleteResource.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  resourceId: string;
  resourceName: string;
}

export function SettingsPanel({ resourceId, resourceName }: SettingsPanelProps) {
  const [filter, setFilter] = useState("");

  const { data: resource } = useTanstackQuery(
    orpc.resource.getById.queryOptions({ input: { resourceId } }),
  );

  const updateResource = useMutation(orpc.resource.update.mutationOptions());

  const handleSave = async (data: Record<string, unknown>) => {
    try {
      await updateResource.mutateAsync({ resourceId, ...data } as Parameters<typeof updateResource.mutateAsync>[0]);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <div className="relative pt-4">
      {/* Filter bar */}
      <div className="mb-6">
        <Input
          placeholder="Filter Settings..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full"
        />
      </div>

      <div className="flex gap-8">
        {/* Content */}
        <div className="min-w-0 flex-1 space-y-10">
          <SourceSection />
          <NetworkingSection />
          <ScaleSection
            resourceId={resourceId}
            replicas={resource?.replicas ?? null}
            port={resource?.port ?? null}
            onSave={handleSave}
            saving={updateResource.isPending}
          />
          <BuildSection
            builder={resource?.builder ?? null}
            dockerfilePath={resource?.dockerfilePath ?? null}
            onSave={handleSave}
            saving={updateResource.isPending}
          />
          <DeploySection
            healthCheckPath={resource?.healthCheckPath ?? null}
            onSave={handleSave}
            saving={updateResource.isPending}
          />
          <ConfigSection />
          <DangerSection resourceId={resourceId} resourceName={resourceName} />
        </div>

        {/* Side nav */}
        <nav className="hidden shrink-0 lg:block">
          <ul className="sticky top-4 space-y-1 text-sm">
            {SECTION_IDS.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {SECTION_LABELS[id]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
