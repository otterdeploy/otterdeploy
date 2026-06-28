/**
 * Per-builder configuration cards for the Builder step. Split out of
 * builder.tsx to keep that file under the max-lines cap. `StepBuilder`
 * renders `<BuilderConfig builderId={…} />`.
 *
 * All inputs are blank with placeholders — these are the operator's choices,
 * not claims about their repo. Auto-detection lives in the banner above,
 * driven by the real `git.inspectRepo` result.
 */

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";

import { Field } from "../form-primitives";
import { I } from "../icons";

// ────── BuilderConfigHeader ──────
function ConfigHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icon}
      <span className="text-[13px] font-semibold">{title}</span>
      {children}
    </div>
  );
}

// ────── BuilderConfig ──────
export function BuilderConfig({ builderId }: { builderId: string }) {
  if (builderId === "railpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.bolt width={14} height={14} className="text-muted-foreground" />}
          title="Railpack auto-detect"
        />
        <p className="mb-3.5 text-xs text-muted-foreground">
          Railpack inspects your repo and assembles an OCI image automatically. Override individual
          layers below if needed.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Install command (override)">
            <Input className="font-mono" placeholder="auto" />
          </Field>
          <Field label="Build command (override)">
            <Input className="font-mono" placeholder="auto" />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Root directory">
            <Input className="font-mono" placeholder="e.g. apps/web · empty = repo root" />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "dockerfile") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.doc width={14} height={14} className="text-muted-foreground" />}
          title="Dockerfile"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Dockerfile path">
            <Input className="font-mono" placeholder="Dockerfile" />
          </Field>
          <Field label="Build context">
            <Input className="font-mono" placeholder="." />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Target stage (multi-stage)">
            <Input className="font-mono" placeholder="optional · e.g. runtime" />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Build args (one per line, KEY=value)">
            <Textarea
              className="font-mono"
              rows={3}
              placeholder={"NODE_VERSION=24\nGIT_SHA=$COMMIT_SHA"}
            />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "compose") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.service width={14} height={14} className="text-muted-foreground" />}
          title="Docker Compose"
        >
          <Badge variant="outline" className="gap-1">
            <I.warning width={9} height={9} />
            deploys all services in compose.yml as a Docker Stack
          </Badge>
        </ConfigHeader>
        <Field label="Compose file">
          <Input className="font-mono" placeholder="compose.yml" />
        </Field>
        <div className="mt-2.5">
          <Field label="Profiles (comma separated)">
            <Input className="font-mono" placeholder="prod, observability" />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "buildpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader icon={<I.folder width={14} height={14} />} title="Cloud-Native Buildpacks" />
        <Field label="Builder image">
          <Select
            defaultValue="paketo"
            items={[
              {
                label: "paketobuildpacks/builder-jammy-base:latest",
                value: "paketo",
              },
              { label: "heroku/builder:24", value: "heroku" },
              { label: "gcr.io/buildpacks/builder:v1", value: "gcp" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paketo">paketobuildpacks/builder-jammy-base:latest</SelectItem>
              <SelectItem value="heroku">heroku/builder:24</SelectItem>
              <SelectItem value="gcp">gcr.io/buildpacks/builder:v1</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="mt-2.5">
          <Field label="Buildpacks (in order, one per line)">
            <Textarea
              className="font-mono"
              rows={3}
              placeholder={"auto — leave blank to let the builder choose"}
            />
          </Field>
        </div>
      </Card>
    );
  }

  // static (default)
  return (
    <Card className="p-4.5">
      <ConfigHeader icon={<I.globe width={14} height={14} />} title="Static site" />
      <Field label="Build command">
        <Input className="font-mono" placeholder="e.g. pnpm build" />
      </Field>
      <div className="mt-2.5">
        <Field label="Output directory">
          <Input className="font-mono" placeholder="e.g. dist" />
        </Field>
      </div>
    </Card>
  );
}
