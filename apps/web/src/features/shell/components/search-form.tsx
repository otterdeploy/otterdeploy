"use client"

import { Label } from "@/shared/components/ui/label"
import { SidebarInput } from "@/shared/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import { SearchIcon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"

export function SearchForm({ ...props }: React.ComponentProps<"form">) {
  const { t } = useTranslation()
  return (
    <form {...props}>
      <div className="relative">
        <Label htmlFor="search" className="sr-only">
          {t("common.search")}
        </Label>
        <SidebarInput
          id="search"
          placeholder={t("shell.searchPlaceholder")}
          className="h-8 pl-7"
        />
        <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
      </div>
    </form>
  )
}
