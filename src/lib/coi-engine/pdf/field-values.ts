/**
 * AcroForm value semantics for the in-place form editor — client-safe.
 *
 * This module must stay free of `pdf-lib` (and of anything else heavy): it is
 * imported by browser components, and `src/lib/coi-pdf.ts` — the other home of
 * these rules — pulls pdf-lib into whatever imports it. `coi-pdf.ts` re-exports
 * the tick predicate from here so the two paths can never drift; its own
 * comment records what drift cost last time ("ticked in the editor, blank on
 * download").
 */

import type { FieldKind } from "./geometry";

function normalizeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Single source of truth for which scalar tokens count as "checked". Moved here
 * from `coi-pdf.ts` (which re-exports it) so client code can read it without
 * dragging pdf-lib onto the bundle.
 *
 * If you add a sentinel here, every consumer — the COI editor projection, the
 * PDF fill path, and the form editor's overlay — picks it up automatically.
 */
export const TRUTHY_YN_VALUE_SET: ReadonlySet<string> = new Set([
  "true",
  "1",
  "yes",
  "y",
  "on",
  "checked",
  "check",
  "selected",
  "x",
]);

export function isTruthyCheckboxValue(value: unknown): boolean {
  const normalized = normalizeFieldValue(value).trim().toLowerCase();
  if (!normalized) return false;
  return TRUTHY_YN_VALUE_SET.has(normalized);
}

/** Strip the PDF name-object slash: `/Yes` → `Yes`. Values reach us both ways
 * depending on which door read the form. */
export function stripPdfNameSlash(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^\//, "").trim();
}

/**
 * Is this checkbox/radio widget ticked?
 *
 * The authority is the widget's OWN export value — the `/AS` state name that
 * means ON for this particular box (`Yes`, `1`, `choice1`, …). Checkbox groups
 * give each kid a different one, so "does it equal Yes" is never a safe test,
 * and neither is "is it truthy": `choice1` is not in any truthy set yet it is
 * exactly what a ticked USLI box carries.
 *
 * Order: the widget's own export value, then the universal off-states, then the
 * shared truthy set as a fallback for extractors that normalize to `true`.
 */
export function isWidgetTicked(
  raw: string | null | undefined,
  exportValue?: string | null,
): boolean {
  const token = stripPdfNameSlash(raw);
  if (!token) return false;
  const on = stripPdfNameSlash(exportValue);
  // `Off` is the AcroForm off-state for EVERY widget, and it outranks the
  // export value: a box may legitimately name its ON state "No" (pdf.js reports
  // the non-Off appearance key), and without this order an unticked such box
  // read as ticked, could not be unticked, and the revision re-ticked it.
  if (/^off$/i.test(token)) return false;
  if (on && token.toLowerCase() === on.toLowerCase()) return true;
  if (/^(no|false|0|none|unchecked)$/i.test(token)) return false;
  // Not this widget's on-state and not a known off-state: fall back to the
  // shared truthy set rather than guessing.
  return isTruthyCheckboxValue(token);
}

/** The AcroForm token to write for a tick state — the widget's own export value
 * when it has one (what `forms revision publish` expects), else the generic
 * `Yes`/`Off` pair. */
export function widgetTokenFor(
  ticked: boolean,
  exportValue?: string | null,
): string {
  if (!ticked) return "Off";
  const on = stripPdfNameSlash(exportValue);
  return on || "Yes";
}

/**
 * What a person should read for a field's recorded answer.
 *
 * `kind` matters: for a checkbox the answer is Yes/No, and the raw token
 * (`Off`, `choice1`, `true`) must never reach the operator — that is the
 * "I see choice1 instead of a neat ✗" report. For text the recorded string is
 * the answer, minus the PDF slash.
 */
export function readableFieldValue(
  raw: string | null | undefined,
  kind: FieldKind = "text",
  exportValue?: string | null,
): { value: string; blank: boolean } {
  const trimmed = (raw ?? "").trim();
  if (kind === "checkbox" || kind === "radio") {
    // A checkbox is never "blank" in the text sense — it is ticked or not, and
    // an untouched box is a real answer ("No") on a printed form. Only a
    // genuinely absent value stays blank so the counters don't over-report.
    if (!trimmed) return { value: "No (unchecked)", blank: true };
    return isWidgetTicked(trimmed, exportValue)
      ? { value: "Yes (checked)", blank: false }
      : { value: "No (unchecked)", blank: false };
  }
  if (!trimmed) return { value: "Blank on the form", blank: true };
  const token = stripPdfNameSlash(trimmed);
  // A slashed PDF name object on a field we believe is text is still a
  // checkbox in practice (the schema disagreed with the PDF) — read it as one.
  if (trimmed.startsWith("/")) {
    if (/^(off|no|false|0)$/i.test(token)) return { value: "No (unchecked)", blank: false };
    if (/^(yes|on|true|1)$/i.test(token)) return { value: "Yes (checked)", blank: false };
  }
  return { value: token.length ? token : trimmed, blank: false };
}
