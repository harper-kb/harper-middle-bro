"use client";

import { createPortal } from "react-dom";

/**
 * Shared focus layer for anchored filter popovers. The active trigger and
 * panel sit at z60; this body-level z55 layer softens the same application
 * boundary Records uses and absorbs the outside pointer sequence.
 */
export function FilterFocusBackdrop({
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
