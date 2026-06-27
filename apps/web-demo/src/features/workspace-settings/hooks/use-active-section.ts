import { useCallback, useState } from "react";

import type { SettingsSection } from "../types";

export function useActiveSection(sections: ReadonlyArray<SettingsSection>) {
  const [activeId, setActiveId] = useState<string>(() => sections[0]?.id ?? "");
  const setActive = useCallback(
    (id: string) => {
      if (sections.some((s) => s.id === id)) setActiveId(id);
    },
    [sections],
  );
  return { activeId, setActive };
}
