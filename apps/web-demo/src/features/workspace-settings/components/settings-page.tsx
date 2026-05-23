import {
  BellIcon,
  CloudIcon,
  GitBranchIcon,
  HardDriveIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";

export function SettingsPage() {
  return (
    <div className="grid gap-8 p-6">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Workspace settings
          </h1>
          <Badge variant="outline">Infrastructure control plane</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Global credentials, ingress behavior, backup destinations,
          certificates, and alerting live here so each project can stay focused
          on app-level config.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Connected surfaces"
          value="8"
          detail="Git, registries, storage, certificates, notifications"
          icon={<GitBranchIcon className="size-4" />}
        />
        <SummaryCard
          title="Secrets under management"
          value="24"
          detail="Keys, PATs, TLS material, and webhook endpoints"
          icon={<ShieldCheckIcon className="size-4" />}
        />
        <SummaryCard
          title="Backup coverage"
          value="3 destinations"
          detail="R2, S3, and Backblaze rotation policies staged"
          icon={<CloudIcon className="size-4" />}
        />
        <SummaryCard
          title="Notification targets"
          value="4 channels"
          detail="Slack, Discord, email, and outbound webhooks"
          icon={<BellIcon className="size-4" />}
        />
      </div>

      <div className="grid gap-10">
        <Section id="overview" title="Overview">
          <Field>
            <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
            <Input id="ws-name" defaultValue="otterstack" disabled />
            <FieldDescription>
              Workspace metadata persistence lands with the settings API.
            </FieldDescription>
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Admin URL"
              value="ops.otterstack.local"
              sub="Pinned to the control plane ingress"
            />
            <StatCard
              label="Release channel"
              value="beta"
              sub="Auto-upgrades paused pending maintenance window"
            />
            <StatCard
              label="Audit retention"
              value="30 days"
              sub="Applies to deploy, restore, and admin actions"
            />
          </div>
        </Section>
        <Section id="account" title="Account">
          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              label="CLI tokens"
              value="2 active"
              sub="One local dev token and one CI token are provisioned"
            />
            <StatCard
              label="Sessions"
              value="3 devices"
              sub="MacBook Pro, staging bastion, and browser session"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">cli-local</TableCell>
                <TableCell className="text-muted-foreground">
                  projects:read write
                </TableCell>
                <TableCell className="text-muted-foreground">12m ago</TableCell>
                <TableCell>
                  <Badge variant="success">active</Badge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">ci-preview</TableCell>
                <TableCell className="text-muted-foreground">
                  deployments:write
                </TableCell>
                <TableCell className="text-muted-foreground">
                  yesterday
                </TableCell>
                <TableCell>
                  <Badge variant="outline">rotates weekly</Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>
        <Section id="profile" title="Profile">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
              <Input
                id="profile-name"
                defaultValue="Jefferson Chukwuka"
                disabled
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                id="profile-email"
                defaultValue="jefferson@otterstack.dev"
                disabled
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-role">Role</FieldLabel>
              <Input id="profile-role" defaultValue="Owner" disabled />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-2fa">Security</FieldLabel>
              <Input
                id="profile-2fa"
                defaultValue="TOTP enabled · recovery codes stored"
                disabled
              />
            </Field>
          </div>
        </Section>
        <Section id="web-server" title="Web Server">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Ingress engine"
              value="Caddy"
              sub="Global HTTP/TLS entrypoint for all public routes"
            />
            <StatCard
              label="ACME issuer"
              value="Let's Encrypt"
              sub="Wildcard certs staged through DNS challenge"
            />
            <StatCard
              label="Reload cadence"
              value="hot reload"
              sub="Config changes apply without dropping sockets"
            />
          </div>
          <Field>
            <FieldLabel htmlFor="caddy-preview">
              Global config preview
            </FieldLabel>
            <Textarea
              id="caddy-preview"
              disabled
              defaultValue={`{
  email ops@otterstack.dev
  admin off
}

*.otterstack.local {
  encode gzip zstd
  tls {
    dns cloudflare {env.CLOUDFLARE_API_TOKEN}
  }
}`}
            />
            <FieldDescription>
              Route-level edits still happen from workspace routing and
              per-project networking.
            </FieldDescription>
          </Field>
        </Section>
        <Section id="ssh-keys" title="SSH Keys">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                [
                  "prod-deploy",
                  "SHA256:4G...k9",
                  "git clone + node bootstrap",
                  "5m ago",
                ],
                [
                  "staging-recovery",
                  "SHA256:9D...m1",
                  "manual SSH access",
                  "3 days ago",
                ],
              ].map(([name, fingerprint, scope, lastUsed]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fingerprint}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {scope}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lastUsed}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <Section id="git-providers" title="Git Providers">
          <ConnectionTable
            rows={[
              [
                "GitHub",
                "paperhouse-inc",
                "OAuth app · repos + webhooks",
                "healthy",
              ],
              [
                "GitLab",
                "self-hosted",
                "PAT fallback · group mirror",
                "staged",
              ],
              [
                "Gitea / Forgejo",
                "optional",
                "Ready for self-hosted installs",
                "not connected",
              ],
            ]}
            columnLabel="Org / instance"
          />
        </Section>
        <Section id="registries" title="Registries">
          <ConnectionTable
            rows={[
              [
                "GHCR",
                "ghcr.io/paperhouse",
                "PAT with read:packages",
                "healthy",
              ],
              ["Docker Hub", "paperhouse", "robot account", "healthy"],
              ["AWS ECR", "eu-central-1", "assume-role pull access", "staged"],
            ]}
            columnLabel="Namespace"
          />
        </Section>
        <Section id="s3-destinations" title="S3 Destinations">
          <ConnectionTable
            rows={[
              [
                "Cloudflare R2",
                "daily backups",
                "postgres + volume snapshots",
                "healthy",
              ],
              [
                "AWS S3",
                "disaster recovery",
                "cross-region archive",
                "healthy",
              ],
              ["Backblaze B2", "cold storage", "monthly exports", "staged"],
            ]}
            columnLabel="Purpose"
          />
        </Section>
        <Section id="certificates" title="Certificates">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificate</TableHead>
                <TableHead>Issuer</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                [
                  "*.otterstack.local",
                  "Let's Encrypt",
                  "in 67 days",
                  "healthy",
                ],
                [
                  "console.paperhouse.dev",
                  "Custom PEM chain",
                  "in 11 days",
                  "renew soon",
                ],
                [
                  "api.paperhouse.dev",
                  "Let's Encrypt",
                  "in 84 days",
                  "healthy",
                ],
              ].map(([name, issuer, expires, status]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {issuer}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {expires}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <Section id="cluster" title="Cluster">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Managers" value="3" sub="Quorum healthy" />
            <StatCard
              label="Workers"
              value="5"
              sub="One GPU node draining builds"
            />
            <StatCard
              label="Image pull cache"
              value="enabled"
              sub="Warm on managers and edge nodes"
            />
            <StatCard
              label="Log retention"
              value="14 days"
              sub="Container + access logs rotated nightly"
            />
          </div>
          <Field>
            <FieldLabel htmlFor="cluster-policy">Scheduling notes</FieldLabel>
            <Textarea
              id="cluster-policy"
              disabled
              defaultValue={`- spread replicas across availability zones
- reserve manager-only placement for control services
- pin GPU workloads to node label gpu=true`}
            />
          </Field>
        </Section>
        <Section id="notifications" title="Notifications">
          <ConnectionTable
            rows={[
              [
                "Slack",
                "#platform-alerts",
                "deploys, cert renewals, restore failures",
                "healthy",
              ],
              ["Discord", "ops-war-room", "incident-only fanout", "healthy"],
              [
                "Email",
                "oncall@otterstack.dev",
                "digest + critical alerts",
                "healthy",
              ],
              [
                "Webhook",
                "https://hooks.pager.app/...",
                "machine-readable event stream",
                "staged",
              ],
            ]}
            columnLabel="Destination"
          />
        </Section>
        <Section id="identity" title="Identity & SSO">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="OIDC"
              value="configured"
              sub="Google Workspace team login"
            />
            <StatCard
              label="SAML"
              value="planned"
              sub="Reserved for enterprise workspaces"
            />
            <StatCard
              label="SCIM"
              value="not enabled"
              sub="Provisioning waits on org lifecycle hooks"
            />
          </div>
        </Section>
        <Section id="billing" title="Billing">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Plan"
              value="Enterprise self-hosted"
              sub="Includes audit retention and SSO"
            />
            <StatCard
              label="Current usage"
              value="12 projects"
              sub="5 remote servers · 43 deployed services"
            />
            <StatCard
              label="Next invoice"
              value="May 31"
              sub="Usage export can be pushed to finance"
            />
          </div>
        </Section>
        <Section id="danger" title="Danger zone">
          <div className="flex flex-wrap gap-3">
            <Button variant="destructive" disabled>
              Delete workspace
            </Button>
            <Button variant="outline" disabled>
              Rotate all credentials
            </Button>
            <Button variant="outline" disabled>
              Pause ingress
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Destructive mutations stay disabled until the workspace settings API
            is fully wired.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-section-id={id} className="grid gap-4 scroll-mt-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="grid gap-4 rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          <div className="rounded-md border bg-background p-2 text-muted-foreground">
            {icon}
          </div>
        </div>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-base">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {sub}
      </CardContent>
    </Card>
  );
}

function ConnectionTable({
  rows,
  columnLabel,
}: {
  rows: ReadonlyArray<readonly [string, string, string, string]>;
  columnLabel: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Connection</TableHead>
          <TableHead>{columnLabel}</TableHead>
          <TableHead>Usage</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([name, scope, usage, status]) => (
          <TableRow key={name}>
            <TableCell className="font-medium">{name}</TableCell>
            <TableCell className="text-muted-foreground">{scope}</TableCell>
            <TableCell className="text-muted-foreground">{usage}</TableCell>
            <TableCell>
              <StatusBadge status={status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    normalized === "healthy" || normalized === "active"
      ? "success"
      : normalized === "renew soon" || normalized === "staged"
        ? "warning"
        : normalized === "not connected"
          ? "outline"
          : "info";
  return <Badge variant={variant}>{status}</Badge>;
}
