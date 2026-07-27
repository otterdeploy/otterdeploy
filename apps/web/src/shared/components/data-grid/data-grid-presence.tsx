"use client";

import * as React from "react";

interface DataGridCellPresence {
  color: string;
  name: string;
}

const DataGridCellPresenceContext = React.createContext<Map<string, DataGridCellPresence> | null>(
  null,
);

function useDataGridPresence(cellKey: string): DataGridCellPresence | null {
  const map = React.useContext(DataGridCellPresenceContext);
  return map?.get(cellKey) ?? null;
}

export { useDataGridPresence, type DataGridCellPresence };
