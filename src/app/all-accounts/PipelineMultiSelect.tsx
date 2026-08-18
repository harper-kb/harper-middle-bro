"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RecordsFilterFocusBackdrop } from "./RecordsFilterFocusBackdrop";

/**
 * Shared contextual multi-select for the source-scoped pipeline filters —
 * IQ Stage and Broker Gate. One visual component; the axis-specific
 * vocabulary (option ids, codes, labels, ordering) stays with the caller.
 *
 * Empty selection means "everything" (no URL param). The compact trigger
 * announces the count; the popover offers checkboxes with Select all / Clear
 * and scrolls internally when the option list outgrows the viewport cap.
 */

export type PipelineMultiSelectOption<Id extends string> = {
  id: Id;
  /** Prominent short code (e.g. G4) shown before the label when present. */
  code?: string | null;
  label: string;
};

export type PipelineAccent = "iq" | "broker";

function triggerLabel(count: number, noun: string): string {
  if (count === 0) return `All ${noun}s`;
  if (count === 1) return `1 ${noun} selected`;
  return `${count} ${noun}s selected`;
}

export function PipelineMultiSelect<Id extends string>({
  options,
  selected,
  onChange,
  onToggle,
  labelledBy,
  accent,
  noun,
  triggerIcon,
}: {
  options: readonly PipelineMultiSelectOption<Id>[];
  selected: readonly Id[];
  onChange: (next: Id[]) => void;
  /** Latest-state-aware toggle for URL-owned selections. */
  onToggle?: (id: Id) => void;
  labelledBy: string;
  accent: PipelineAccent;
  /** Singular unit for the collapsed label: "stage" or "gate". */
  noun: string;
  /** Optional subtle identity icon rendered inside the trigger. */
  triggerIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const selectedSet = new Set(selected);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: Id) {
    if (onToggle) {
      onToggle(id);
      return;
    }
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <>
      {open ? (
        <RecordsFilterFocusBackdrop onDismiss={() => setOpen(false)} />
      ) : null}
      <div
        className={`pipeline-select pipeline-select--${accent}${
          open ? " records-filter-control--open" : ""
        }`}
        ref={rootRef}
      >
      <button
        ref={triggerRef}
        type="button"
        className="filter-select pipeline-trigger"
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerIcon}
        <span className="pipeline-trigger-label">
          {triggerLabel(selected.length, noun)}
        </span>
        {/* Explicit intrinsic size: an SVG with no width/height renders at
            300×150 if a stylesheet ever lags a markup change. */}
        <svg
          viewBox="0 0 12 12"
          width={12}
          height={12}
          fill="none"
          aria-hidden="true"
          className="pipeline-chevron"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={listId}
          className="pipeline-popover"
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelledBy}
        >
          <div className="pipeline-popover-actions">
            <button
              type="button"
              className="filter-clear"
              onClick={() => onChange(options.map((o) => o.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="filter-clear"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <ul className="pipeline-popover-list">
            {options.map((option) => {
              const checked = selectedSet.has(option.id);
              return (
                <li key={option.id}>
                  <label className="pipeline-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option.id)}
                    />
                    {option.code ? (
                      <span className="pipeline-option-code">
                        {option.code}
                      </span>
                    ) : null}
                    <span>{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      </div>
    </>
  );
}
