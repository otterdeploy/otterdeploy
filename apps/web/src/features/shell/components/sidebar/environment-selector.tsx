import { useTranslation } from "react-i18next";

import type { Environment } from "@/routes/_app/layout";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export function EnvironmentSelector({
  environments,
  value,
  onValueChange,
}: {
  environments: Environment[];
  value?: string;
  onValueChange: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      onValueChange={(value) => value && onValueChange(value)}
      items={environments.map((env) => ({
        label: env.name,
        value: env.slug,
      }))}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("environments.label")}</SelectLabel>
          {environments.map((env) => (
            <SelectItem key={env.slug} value={env.slug}>
              {env.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
