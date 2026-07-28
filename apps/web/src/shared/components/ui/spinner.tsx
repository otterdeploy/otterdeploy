import type { ComponentProps } from "react";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

function Spinner({ className, ...props }: Omit<ComponentProps<"svg">, "strokeWidth">) {
  const { t } = useTranslation();
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={2}
      role="status"
      aria-label={t("common.loadingLabel")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
