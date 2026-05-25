// Step_Image — container registry, image path + tag, available tags, service name, update strategy.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1143-1355.
import type { AnyFieldApi } from "@tanstack/react-form";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import {
  SectionHeader,
  Field,
  SettingRow,
  builderCardClass,
  builderCardActiveClass,
} from "../form-primitives";
import { I } from "../icons";

interface ImageProps {
  imageField: AnyFieldApi;
  tagField: AnyFieldApi;
  registryField: AnyFieldApi;
  nameField: AnyFieldApi;
}

const registries = [
  { id: "docker", name: "Docker Hub", host: "docker.io", auth: "public" },
  {
    id: "ghcr",
    name: "GitHub Container Registry",
    host: "ghcr.io",
    auth: "paperhouse · pat",
  },
  {
    id: "ecr",
    name: "AWS ECR",
    host: "847395.dkr.ecr.us-west-2.amazonaws.com",
    auth: "iam role",
  },
  {
    id: "gcr",
    name: "Google Artifact Registry",
    host: "us-docker.pkg.dev",
    auth: "service account",
  },
  {
    id: "private",
    name: "Private registry",
    host: "registry.helio.so",
    auth: "basic",
  },
];

const availableTags = [
  { tag: "latest", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
  { tag: "v2.4.1", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
  { tag: "v2.4.0", size: "141 MB", pushed: "1d ago", sha: "8b1e9d4" },
  { tag: "v2.3.0", size: "139 MB", pushed: "1w ago", sha: "c2a5f01" },
  { tag: "main", size: "143 MB", pushed: "12m ago", sha: "f7c3a91" },
];

const getRegistryBrand = (id: string): string | null =>
  id === "docker"
    ? "Docker"
    : id === "ghcr"
      ? "GitHub"
      : id === "ecr"
        ? "AWS"
        : id === "gcr"
          ? "Google Cloud"
          : null;

export function StepImage({ imageField, tagField, registryField, nameField }: ImageProps) {
  const image = imageField.state.value as string;
  const tag = tagField.state.value as string;
  const registry = registryField.state.value as string;

  const resolvedHost = registries.find((r) => r.id === registry)?.host ?? "";

  return (
    <>
      <SectionHeader title="Container registry" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {registries.map((r) => {
          const registryBrand = getRegistryBrand(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => registryField.handleChange(r.id)}
              className={cn(builderCardClass, registry === r.id && builderCardActiveClass)}
            >
              <div className="flex items-center gap-2">
                {registryBrand ? (
                  <SvglLogo
                    search={registryBrand}
                    fallback={r.name}
                    size={16}
                    background="transparent"
                    border="0"
                    color="currentColor"
                    style={{ borderRadius: 0 }}
                  />
                ) : (
                  <I.service width={13} height={13} />
                )}
                <div className="text-[13px] font-semibold">{r.name}</div>
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{r.host}</div>
              <div className="mt-1.5">
                <Badge variant="outline" className="gap-1 font-mono text-[10px] font-normal">
                  <I.lock width={9} height={9} />
                  {r.auth}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <SectionHeader title="Image" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-2">
          <div className="grid grid-cols-[2fr_1fr] gap-2.5">
            <Field label="Image">
              <Input
                className="font-mono"
                value={image}
                onChange={(e) => imageField.handleChange(e.target.value)}
              />
            </Field>
            <Field label="Tag">
              <Input
                className="font-mono"
                value={tag}
                onChange={(e) => tagField.handleChange(e.target.value)}
              />
            </Field>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            resolved →{" "}
            <span className="text-foreground">
              {resolvedHost}/{image}:{tag}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4">
        <SectionHeader title="Available tags" sub="Recently pushed to this repository" />
      </div>
      <Card className="mt-2.5 gap-0 overflow-hidden rounded-md p-0">
        {availableTags.map((t, i) => {
          const isSelected = tag === t.tag;
          return (
            <button
              key={t.tag}
              type="button"
              onClick={() => tagField.handleChange(t.tag)}
              aria-pressed={isSelected}
              className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-foreground transition-colors hover:bg-accent/40 ${
                i === availableTags.length - 1 ? "" : "border-b border-border/60"
              } ${isSelected ? "bg-accent" : ""}`}
            >
              <I.doc width={12} height={12} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 font-mono text-[13px] font-medium">{t.tag}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.sha}</span>
              <span className="text-[11px] text-muted-foreground">{t.size}</span>
              <span className="w-20 text-right text-[11px] text-muted-foreground">{t.pushed}</span>
              {isSelected && <I.check width={11} height={11} className="text-success" />}
            </button>
          );
        })}
      </Card>

      <div className="mt-4">
        <SectionHeader title="Service name" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <Field label="Name">
            <Input
              className="font-mono"
              value={nameField.state.value as string}
              onChange={(e) => nameField.handleChange(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="mt-4">
        <SectionHeader title="Update strategy" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <SettingRow
            label="Watch tag for changes"
            defaultOn
            sub={`Pull and redeploy when :${tag} digest changes`}
          />
          <SettingRow
            label="Verify image signature (cosign)"
            sub="Reject pulls that fail signature verification"
          />
          <SettingRow
            label="Allow tag mutation"
            sub={`Re-pull on every deploy even if :${tag} digest is identical`}
          />
        </CardContent>
      </Card>
    </>
  );
}
