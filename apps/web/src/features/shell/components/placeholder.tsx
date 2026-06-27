import { Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Page, PageHeader } from "@/shared/components/page";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/components/ui/empty";

export function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={Rocket01Icon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>Coming soon</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
      </Empty>
    </Page>
  );
}
