import { useNavigate, useSearch } from "@tanstack/react-router";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group";
import type { Environment } from "@/routes/_app/layout";

export function EnvironmentTabs({
  environments,
}: {
  environments: Environment[];
}) {
  const navigate = useNavigate();
  const { env } = useSearch({ from: "/_app/$orgSlug/$projectSlug" });

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const currentSlug = env ?? defaultEnv?.slug;

  return (
    <ToggleGroup
      value={currentSlug ? [currentSlug] : []}
      onValueChange={(value) => {
        const next = value[0];
        if (next && typeof next === "string") {
          void navigate({ search: (prev) => ({ ...prev, env: next }) });
        }
      }}
      spacing={0}
      variant="outline"
      size="sm"
      className="h-8"
    >
      {environments.map((envOption) => (
        <ToggleGroupItem
          key={envOption.slug}
          value={envOption.slug}
          className="px-3 text-xs"
        >
          {envOption.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
