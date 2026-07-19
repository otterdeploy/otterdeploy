"use client";

import * as React from "react";

import type { DataGridCellProps } from "@/shared/components/data-grid/types";

import { useDataGridPresence } from "@/shared/components/data-grid/data-grid-presence";
import { useComposedRefs } from "@/shared/components/data-grid/lib/compose-refs";
import { getCellKey } from "@/shared/components/data-grid/lib/data-grid";
import { cn } from "@/shared/lib/utils";

interface DataGridCellWrapperProps<TData>
  extends DataGridCellProps<TData>, React.ComponentProps<"div"> {}

export function DataGridCellWrapper<TData>({
  tableMeta,
  rowIndex,
  columnId,
  isEditing,
  isFocused,
  isSelected,
  isSearchMatch,
  isActiveSearchMatch,
  readOnly,
  rowHeight,
  className,
  onClick: onClickProp,
  onKeyDown: onKeyDownProp,
  ref,
  ...props
}: DataGridCellWrapperProps<TData>) {
  const cellMapRef = tableMeta?.cellMapRef;
  const cellPresence = useDataGridPresence(getCellKey(rowIndex, columnId));

  const onCellChange = (node: HTMLDivElement | null) => {
    if (!cellMapRef) return;

    const cellKey = getCellKey(rowIndex, columnId);

    if (node) {
      cellMapRef.current.set(cellKey, node);
    } else {
      cellMapRef.current.delete(cellKey);
    }
  };

  const composedRef = useComposedRefs(ref, onCellChange);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditing) {
      event.preventDefault();
      onClickProp?.(event);
      if (isFocused && !readOnly) {
        tableMeta?.onCellEditingStart?.(rowIndex, columnId);
      } else {
        tableMeta?.onCellClick?.(rowIndex, columnId, event);
      }
    }
  };

  const onContextMenu = (event: React.MouseEvent) => {
    if (!isEditing) {
      tableMeta?.onCellContextMenu?.(rowIndex, columnId, event);
    }
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (!isEditing) {
      event.preventDefault();
      tableMeta?.onCellDoubleClick?.(rowIndex, columnId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDownProp?.(event);

    if (event.defaultPrevented) return;

    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Tab"
    ) {
      return;
    }

    if (isFocused && !isEditing && !readOnly) {
      if (event.key === "F2" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        tableMeta?.onCellEditingStart?.(rowIndex, columnId);
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        tableMeta?.onCellEditingStart?.(rowIndex, columnId);
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        tableMeta?.onCellEditingStart?.(rowIndex, columnId);
      }
    }
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (!isEditing) {
      tableMeta?.onCellMouseDown?.(rowIndex, columnId, event);
    }
  };

  const onMouseEnter = () => {
    if (!isEditing) {
      tableMeta?.onCellMouseEnter?.(rowIndex, columnId);
    }
  };

  const onMouseUp = () => {
    if (!isEditing) {
      tableMeta?.onCellMouseUp?.();
    }
  };

  return (
    <div
      role="button"
      data-slot="grid-cell-wrapper"
      data-editing={isEditing ? "" : undefined}
      data-focused={isFocused ? "" : undefined}
      data-selected={isSelected ? "" : undefined}
      tabIndex={isFocused && !isEditing ? 0 : -1}
      {...props}
      ref={composedRef}
      className={cn(
        "relative size-full px-2 py-1.5 text-start font-mono text-[12px] outline-none has-data-[slot=checkbox]:pt-2.5",
        {
          "ring-1 ring-inset": isFocused || !!cellPresence,
          "ring-ring": isFocused && !cellPresence,
          "bg-yellow-100 dark:bg-yellow-900/30": isSearchMatch && !isActiveSearchMatch,
          "bg-orange-200 dark:bg-orange-900/50": isActiveSearchMatch,
          "bg-primary/10": isSelected && !isEditing,
          "cursor-default": !isEditing,
          "**:data-[slot=grid-cell-content]:truncate": !isEditing && rowHeight === "short",
          "**:data-[slot=grid-cell-content]:line-clamp-2": !isEditing && rowHeight === "medium",
          "**:data-[slot=grid-cell-content]:line-clamp-3": !isEditing && rowHeight === "tall",
          "**:data-[slot=grid-cell-content]:line-clamp-4": !isEditing && rowHeight === "extra-tall",
        },
        className,
      )}
      style={
        cellPresence
          ? ({ "--tw-ring-color": cellPresence.color } as React.CSSProperties)
          : undefined
      }
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseUp={onMouseUp}
      onKeyDown={onKeyDown}
    />
  );
}
