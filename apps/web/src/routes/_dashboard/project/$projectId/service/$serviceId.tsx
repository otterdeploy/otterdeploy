import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@otterstack/ui/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { ScrollArea } from "@/components/ui/scroll-area";

const tabs = [
  {
    label: "Deployment",
    value: "deployment",
  },
  {
    label: "Variables",
    value: "variables",
  },
  {
    label: "Metrics",
    value: "metrics",
  },
  {
    label: "Settings",
    value: "settings",
  },
] as const;

const searchSchema = z.object({
  tab: z.enum(tabs.map((tab) => tab.value)).default("deployment"),
});
export const Route = createFileRoute("/_dashboard/project/$projectId/service/$serviceId")({
  component: RouteComponent,
  validateSearch: searchSchema,
});

function RouteComponent() {
  const { tab } = Route.useSearch();
  return (
    <Tabs defaultValue={tab} className="size-full bg-background p-4">
      <h3 className="text-lg font-medium">Service</h3>
      <TabsList variant="line" className="justify-start border-b border-border -mx-4 px-4 w-[calc(100%+2rem)]">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="flex-none px-2 border-transparent! bg-transparent!">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tabs[0].value} className="size-full bg-red-500">
        <ScrollArea className="h-full">
          <Card className="rounded-none shadow-none h-full">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>
                View your key metrics and recent project activity. Track progress across all your
                active projects.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              You have 12 active projects and 3 pending tasks.
            </CardContent>
          </Card>
        </ScrollArea>
      </TabsContent>
      <TabsContent value={tabs[1].value}>
        <Card>
          <CardHeader>
            <CardTitle>Analytics</CardTitle>
            <CardDescription>
              Track performance and user engagement metrics. Monitor trends and identify growth
              opportunities.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Page views are up 25% compared to last month.
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value={tabs[2].value}>
        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
            <CardDescription>
              Generate and download your detailed reports. Export data in multiple formats for
              analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            You have 5 reports ready and available to export.
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value={tabs[3].value}>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>
              Manage your account preferences and options. Customize your experience to fit your
              needs.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Configure notifications, security, and themes.
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
