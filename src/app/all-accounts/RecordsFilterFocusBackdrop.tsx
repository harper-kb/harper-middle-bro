"use client";

import { createPortal } from "react-dom";

/**
 * Shared focus layer for Records filter popovers. The active trigger/popover
 * sits one layer above it; all other page chrome is softened and cannot steal
 * the pointer sequence that should dismiss the open filter.
 */
export function RecordsFilterFocusBackdrop({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="records-filter-focus-backdrop fixed inset-0"
      data-records-filter-backdrop
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    />,
    document.body,
  );
}
