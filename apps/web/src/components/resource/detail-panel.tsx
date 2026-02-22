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
    hiddenTabs,
    children,
  }: {
    title: string;
    defaultTab: NoInfer<Value>;
    onClose: () => void;
    onTabChange?: (value: Value) => void;
    hiddenTabs?: Value[];
    children: ReactNode;
  }) {
    const visibleTabs = hiddenTabs
      ? tabs.filter((tab) => !hiddenTabs.includes(tab.value as Value))
      : tabs;

    return (
      <Tabs
        defaultValue={defaultTab}
        onValueChange={onTabChange}
        className="size-full bg-background p-6"
      >
        <div className="flex items-center justify-between p-6">
          <h3 className="text-lg font-medium">{title}</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        <TabsList
          variant="line"
          className="relative justify-start border-b border-border -mx-6 px-9 w-[calc(100%+3rem)]"
        >
          {visibleTabs.map((tab) => (
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
      <TabsContent value={value} className="overflow-y-auto py-2 px-6">
        {children}
      </TabsContent>
    );
  }

  const tabValues = tabs.map((t) => t.value) as [Value, ...Value[]];

  return { Panel, Content, tabValues };
}
