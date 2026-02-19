import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  Copy01Icon,
  Delete01Icon,
  DocumentCodeIcon,
  GlobeIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Refresh01Icon,
  Settings01Icon,
  SourceCodeIcon,
  Tick01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const SOURCE_DATA = {
  repo: "documumenso/documenso",
  rootDirectory: null as string | null,
  upstreamRepo: "documenso/documenso",
  branch: "production",
  branchError: "GitHub Repo not found",
};

const NETWORKING_DATA = {
  publicDomain: "documenso-web-production.up.railway.app",
  publicLabel: "Metal Edge",
  privateDomain: "documenso-web.railway.internal",
  privateAlias: "documenso-web",
};

const SCALE_DATA = {
  region: "eu-west",
  regionLabel: "EU West (Amsterdam, Netherlands)",
  replicas: 1,
  cpuLimit: 8,
  cpuPlanLimit: 8,
  memoryLimit: 8,
  memoryPlanLimit: 8,
};

const BUILD_DATA = {
  configFile: "/railway.toml",
  builder: "Dockerfile",
  builderPath: "/docker/Dockerfile",
  metalBuildEnv: true,
  watchPattern: "/src/**",
};

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

function IconButton({ icon, label }: { icon: React.ComponentType; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <HugeiconsIcon icon={icon} size={16} />
    </button>
  );
}

function SectionHeader({
  id,
  icon,
  title,
  variant = "default",
}: {
  id?: string;
  icon: React.ComponentType;
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
// Section: Source
// ---------------------------------------------------------------------------

function SourceSection() {
  return (
    <section className="space-y-6">
      <SectionHeader id="source" icon={SourceCodeIcon} title="Source" />
      <div className="space-y-6 pl-11">
        <SettingField label="Source Repo">
          <InfoRow
            actions={
              <>
                <IconButton icon={PencilEdit01Icon} label="Edit" />
                <Button variant="outline" size="sm">
                  Disconnect
                </Button>
              </>
            }
          >
            <span className="text-sm font-medium">{SOURCE_DATA.repo}</span>
          </InfoRow>
          <p className="text-sm text-muted-foreground">
            <a
              href="#"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Add Root Directory
            </a>{" "}
            (used for build and deploy steps. <DocsLink />)
          </p>
        </SettingField>

        <SettingField label="Upstream Repo">
          <InfoRow
            actions={
              <Button variant="outline" size="sm">
                ← Eject
              </Button>
            }
          >
            <span className="text-sm font-medium">{SOURCE_DATA.upstreamRepo}</span>
          </InfoRow>
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={Refresh01Icon} size={14} />
            Check for updates
          </Button>
        </SettingField>

        <SettingField
          label="Branch connected to production"
          description="Updates will be pulled from the latest commit on this GitHub branch."
        >
          {SOURCE_DATA.branchError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <HugeiconsIcon icon={AlertCircleIcon} size={16} />
              {SOURCE_DATA.branchError}
            </div>
          )}
        </SettingField>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Networking
// ---------------------------------------------------------------------------

function NetworkingSection() {
  return (
    <section className="space-y-6">
      <SectionHeader id="networking" icon={Wifi01Icon} title="Networking" />
      <div className="space-y-6 pl-11">
        <SettingField
          label="Public Networking"
          description="Access your application over HTTP with the following domains"
        >
          <InfoRow
            actions={
              <>
                <IconButton icon={Copy01Icon} label="Copy" />
                <IconButton icon={PencilEdit01Icon} label="Edit" />
                <IconButton icon={Delete01Icon} label="Delete" />
              </>
            }
          >
            <div>
              <p className="text-sm font-medium">{NETWORKING_DATA.publicDomain}</p>
              <p className="text-xs text-primary">{NETWORKING_DATA.publicLabel}</p>
            </div>
          </InfoRow>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5">
              <HugeiconsIcon icon={PlusSignIcon} size={14} />
              Custom Domain
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <HugeiconsIcon icon={PlusSignIcon} size={14} />
              TCP Proxy
            </Button>
          </div>
        </SettingField>

        <SettingField
          label="Private Networking"
          description="Communicate with this service from within the Railway network."
        >
          <InfoRow>
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                {NETWORKING_DATA.privateDomain}
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  IPv4 & IPv6
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                <HugeiconsIcon icon={Tick01Icon} size={12} className="mr-1 inline text-emerald-400" />
                Ready to talk privately · You can also simply call me{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                  {NETWORKING_DATA.privateAlias}
                </code>
              </p>
            </div>
          </InfoRow>
        </SettingField>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Scale
// ---------------------------------------------------------------------------

function ScaleSection() {
  const [cpuLimit, setCpuLimit] = useState(SCALE_DATA.cpuLimit);
  const [memoryLimit, setMemoryLimit] = useState(SCALE_DATA.memoryLimit);
  const [replicas, setReplicas] = useState(String(SCALE_DATA.replicas));

  return (
    <section className="space-y-6">
      <SectionHeader id="scale" icon={GlobeIcon} title="Scale" />
      <div className="space-y-6 pl-11">
        <SettingField
          label="Regions & Replicas"
          description="Deploy replicas per region for horizontal scaling."
        >
          <div className="flex gap-2">
            <Select defaultValue={SCALE_DATA.region}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eu-west">{SCALE_DATA.regionLabel}</SelectItem>
                <SelectItem value="us-west">US West (Portland, Oregon)</SelectItem>
                <SelectItem value="us-east">US East (Virginia)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                value={replicas}
                onChange={(e) => setReplicas(e.target.value)}
                className="w-16 text-center"
              />
              <span className="text-sm text-muted-foreground">Replica</span>
            </div>
          </div>
          <p className="text-sm text-primary">
            Multi-region replicas are only available on the Pro plan.{" "}
            <DocsLink href="#">Learn More</DocsLink>
          </p>
        </SettingField>

        <SettingField
          label="Replica Limits"
          description="Allocate a maximum vCPU and Memory for each replica."
        >
          <div className="bg-card ring-foreground/10 space-y-4 rounded-lg p-4 ring-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  CPU: <strong>{cpuLimit} vCPU</strong>
                </span>
                <span className="text-muted-foreground">
                  Plan limit: {SCALE_DATA.cpuPlanLimit} vCPU
                </span>
              </div>
              <Slider
                value={[cpuLimit]}
                onValueChange={(v) => setCpuLimit(Array.isArray(v) ? v[0] : v)}
                min={0.5}
                max={SCALE_DATA.cpuPlanLimit}
                step={0.5}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  Memory: <strong>{memoryLimit} GB</strong>
                </span>
                <span className="text-muted-foreground">
                  Plan limit: {SCALE_DATA.memoryPlanLimit} GB
                </span>
              </div>
              <Slider
                value={[memoryLimit]}
                onValueChange={(v) => setMemoryLimit(Array.isArray(v) ? v[0] : v)}
                min={0.5}
                max={SCALE_DATA.memoryPlanLimit}
                step={0.5}
              />
            </div>
          </div>
          <p className="text-sm text-primary">
            <HugeiconsIcon icon={PlusSignIcon} size={12} className="mr-1 inline" />
            Upgrade for higher limits
          </p>
        </SettingField>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Build
// ---------------------------------------------------------------------------

function BuildSection() {
  const [metalBuild, setMetalBuild] = useState(BUILD_DATA.metalBuildEnv);
  const [watchPattern, setWatchPattern] = useState(BUILD_DATA.watchPattern);

  return (
    <section className="space-y-6">
      <SectionHeader id="build" icon={Settings01Icon} title="Build" />
      <div className="space-y-6 pl-11">
        <SettingField label="Builder">
          <div className="bg-card ring-foreground/10 space-y-2 rounded-lg p-4 ring-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <HugeiconsIcon icon={AlertCircleIcon} size={14} />
                The value is set in{" "}
                <strong className="text-foreground">{BUILD_DATA.configFile}</strong>
              </span>
              <a
                href="#"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Open file <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
              </a>
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-md px-3 py-2">
              <div>
                <p className="text-sm font-medium">
                  {BUILD_DATA.builder}{" "}
                  <code className="text-xs text-primary">{BUILD_DATA.builderPath}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  Build with a Dockerfile using BuildKit. <DocsLink />
                </p>
              </div>
            </div>
          </div>
        </SettingField>

        <SettingField
          label="Metal Build Environment"
          description="Use our new Metal-based build environment. The new Metal build environment is faster and will be the default for all builds in the coming months."
        >
          <Badge variant="outline" className="mb-1 ml-0.5 border-primary/30 bg-primary/10 text-primary text-[10px]">
            Metal
          </Badge>
          <SwitchRow label="Use Metal Build Environment" checked={metalBuild} onCheckedChange={setMetalBuild} />
        </SettingField>

        <SettingField
          label="Watch Paths"
          description="Gitignore-style rules to trigger a new deployment based on what file paths have changed."
          docsHref="#"
        >
          <div className="relative">
            <Input
              placeholder="Add pattern e.g. /src/**"
              value={watchPattern}
              onChange={(e) => setWatchPattern(e.target.value)}
            />
            <HugeiconsIcon icon={Tick01Icon} size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </SettingField>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Deploy
// ---------------------------------------------------------------------------

function DeploySection() {
  const [teardown, setTeardown] = useState(false);
  const [serverless, setServerless] = useState(false);
  const [restartPolicy, setRestartPolicy] = useState("on-failure");
  const [maxRetries, setMaxRetries] = useState("10");

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
          <p className="text-sm text-muted-foreground">
            +{" "}
            <a
              href="#"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Add pre-deploy step
            </a>{" "}
            (<DocsLink />)
          </p>
        </SettingField>

        <SettingField
          label="Teardown"
          description="Configure old deployment termination when a new one is started."
          docsHref="#"
        >
          <SwitchRow label="Enable Teardown" checked={teardown} onCheckedChange={setTeardown} />
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
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Healthcheck Path
          </Button>
        </SettingField>

        <SettingField
          label="Serverless"
          description="Containers will scale down to zero and then scale up based on traffic. Requests while the container is sleeping will be queued and served when the container wakes up."
          docsHref="#"
        >
          <SwitchRow
            label="Enable Serverless"
            checked={serverless}
            onCheckedChange={setServerless}
          />
        </SettingField>

        <SettingField
          label="Restart Policy"
          description="Configure what to do when the process exits."
          docsHref="#"
        >
          <Select
            value={restartPolicy}
            onValueChange={(v) => {
              if (v) setRestartPolicy(v);
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
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Number of times to try and restart the service if it stopped due to an error.
            </p>
            <Input
              type="number"
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
            />
          </div>
        </SettingField>
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
          label="Railway Config File"
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

function DangerSection() {
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
        <Button variant="destructive" size="sm">
          Delete service
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const [filter, setFilter] = useState("");

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
          <ScaleSection />
          <BuildSection />
          <DeploySection />
          <ConfigSection />
          <DangerSection />
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
