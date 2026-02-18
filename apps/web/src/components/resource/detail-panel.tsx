import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Tab {
  label: string;
  value: string;
}

export function createDetailPanel<const T extends readonly Tab[]>(tabs: T) {
  type Value = T[number]["value"];

  function Panel({
    title,
    defaultTab,
    onClose,
    onTabChange,
    children,
  }: {
    title: string;
    defaultTab: NoInfer<Value>;
    onClose: () => void;
    onTabChange?: (value: Value) => void;
    children: ReactNode;
  }) {
    return (
      <Tabs
        defaultValue={defaultTab}
        onValueChange={onTabChange as ((value: string) => void) | undefined}
        className="size-full bg-background p-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">{title}</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <TabsList
          variant="line"
          className="relative justify-start border-b border-border -mx-4 px-4 w-[calc(100%+2rem)]"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-none px-2 border-transparent! bg-transparent! after:hidden"
            >
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsIndicator />
        </TabsList>

        {children}
      </Tabs>
    );
  }

  function Content({ value, children }: { value: Value; children: ReactNode }) {
    return (
      <TabsContent value={value} className="overflow-y-auto">
        {children}
      </TabsContent>
    );
  }

  const tabValues = tabs.map((t) => t.value) as [Value, ...Value[]];

  return { Panel, Content, tabValues };
}
