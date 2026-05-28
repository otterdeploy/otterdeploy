import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-6">
        <div className="text-center text-sm font-semibold tracking-tight text-foreground">
          otterdeploy
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
        {footer ? (
          <div className="text-center text-xs text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
