import { useNavigate, useSearch } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import type { Environment } from "@/routes/_app/layout";

export function EnvironmentTabsLine({
  environments,
}: {
  environments: Environment[];
}) {
  const navigate = useNavigate();
  const { env } = useSearch({ from: "/_app/$orgSlug/$projectSlug" });

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const currentSlug = env ?? defaultEnv?.slug;

  if (!currentSlug) return null;

  return (
    <Tabs
      value={currentSlug}
      onValueChange={(next) => {
        if (typeof next === "string") {
          void navigate({ search: (prev) => ({ ...prev, env: next }) });
        }
      }}
    >
      <TabsList variant="line" className="h-9">
        {environments.map((envOption) => (
          <TabsTrigger key={envOption.slug} value={envOption.slug} className="px-3">
            {envOption.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
