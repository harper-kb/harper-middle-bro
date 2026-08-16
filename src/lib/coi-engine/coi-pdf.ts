import { stampWidgetAppearanceSubtypes } from './pdf-drawn-content'
import {
  PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFTextField,
  pushGraphicsState, popGraphicsState, setLineWidth, setLineCap,
  LineCapStyle, setStrokingColor, moveTo, lineTo, stroke, rgb,
  StandardFonts,
} from 'pdf-lib'
import type { PDFWidgetAnnotation, PDFOperator } from 'pdf-lib'
import {
  DESCRIPTION_FIELD_ID,
  descriptionFitPlan,
  type DescriptionFitPlan,
} from './acord25-descfit'
import { withCoiProducerDefaults } from './coi-producer'

export interface CoiPdfRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CoiPdfSchemaField {
  field_id: string
  field_name: string
  type: 'text' | 'textarea' | 'checkbox' | string
  page_number: number
  rect?: CoiPdfRect | null
  children?: unknown
}

export interface CoiPdfFormSchema {
  form_id?: string
  fields: CoiPdfSchemaField[]
}

function normalizeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Single source of truth for which scalar tokens count as "checked"
 * for an ACORD Y/N code cell. Exported so the editor (which projects
 * DB → PdfFieldViewer's `'true'`/`'false'` toggle contract) and the
 * PDF-fill / save normalization in this file (which projects → `"Y"`
 * / `""`) stay in lock-step. Drifting these two sets used to cause
 * "ticked in the editor, blank on download" bugs. See
 * `src/components/company/coi-editor.tsx` for the consumer.
 *
 * If you add a new sentinel here (e.g. a new upstream-emitted token),
 * BOTH the editor projection AND the PDF fill path will pick it up
 * automatically — no second place to update.
 *
 * The definition now LIVES in `src/lib/pdf/field-values.ts` and is re-exported
 * here. That module is client-safe; this one imports pdf-lib, so a browser
 * component reading the tick rules through this file would drag pdf-lib onto
 * the bundle (and `/actions` has ~885 bytes of gzip budget left).
 */
export { TRUTHY_YN_VALUE_SET, isTruthyCheckboxValue } from './pdf/field-values'
import { isTruthyCheckboxValue } from './pdf/field-values'

/**
 * Schema field IDs for ACORD 25/30 cells where the AcroForm widget is a
 * text field but the cell's *semantic meaning* is a checkbox (the ADDL
 * INSD and SUBR WVD columns, plus a few coverage-line endorsement code
 * cells). The underlying widget is `..._AdditionalInsuredCode_A` /
 * `..._SubrogationWaivedCode_A` etc. — ACORD specifies these accept a
 * single `Y` or empty.
 *
 * We treat them specially in two places:
 *  1. PDF fill: any truthy-ish value becomes `"Y"`, falsy becomes `""`,
 *     so prod data with mixed `"true"` / `"X"` / `"  Y  "` / `"x"` all
 *     render the same column glyph.
 *  2. Save normalization: when persisting `field_values` back to
 *     Hercules, we collapse to canonical `"Y"` / `""` so the database
 *     stops accumulating heterogeneous representations.
 *
 * Sourced from `public/forms/acord25-schema.json` and
 * `public/forms/acord30-schema.json`. If a new code-cell field is
 * added to either schema, add it here AND to the PdfFieldViewer-side
 * checkbox UI pathway (see `coi-editor.tsx` and `pdf-field-viewer/PdfFieldViewer.tsx`).
 */
export const COI_YN_CODE_FIELD_IDS: readonly string[] = [
  // ACORD 25 — ADDL INSD column
  'cglAdditionalInsuredCheckbox',
  'autoAdditionalInsuredCheckbox',
  'umbrellaAdditionalInsuredCheckbox',
  'otherInsuranceAdditionalInsuredCheckbox',

  // ACORD 25 — SUBR WVD column
  'cglSubrogationWaivedCheckbox',
  'autoSubrogationWaivedCheckbox',
  'umbrellaSubrogationWaivedCheckbox',
  'workersCompSubrogationWaivedCheckbox',
  'otherInsuranceSubrogationWaivedCheckbox',

  // ACORD 25 — WC "Any Persons Excluded" indicator. Same Y-or-empty
  // AcroForm text widget as the AI/SUBR columns above; schema is
  // `type: checkbox` so the editor draws a toggle and the canonical
  // value persisted to `field_values` is `"Y"` / `""`.
  'workersCompExcludedCheckbox',

  // ACORD 30 — same columns, separate field IDs per coverage row
  'garageLiabilityAdditionalInsuredCheckbox',
  'garageLiabilitySubrogationWaivedCheckbox',
  'garageKeepersAdditionalInsuredCheckbox',
  'garageKeepersSubrogationWaivedCheckbox',
  'generalLiabilityAdditionalInsuredCheckbox',
  'generalLiabilitySubrogationWaivedCheckbox',
  'umbrellaExcessAdditionalInsuredCheckbox',
  'umbrellaExcessSubrogationWaivedCheckbox',

  // ACORD 30 — Proprietor/Partner/Executive Officer "Excluded" indicator.
  // Same Y-or-empty AcroForm text widget shape as
  // `workersCompExcludedCheckbox`; flipped to `type: checkbox` in the
  // schema for editor parity.
  'proprietorPartnerExecutiveOfficerExcludedCheckbox',
] as const

const COI_YN_CODE_FIELD_ID_SET = new Set<string>(COI_YN_CODE_FIELD_IDS)

export const COI_MONEY_FIELD_IDS: readonly string[] = [
  // ACORD 25 — General Liability
  'eachOccurrenceLimit',
  'damageToRentedPremisesLimit',
  'medExpLimit',
  'personalAndAdvInjuryLimit',
  'generalAggregateLimit',
  'productsCompOpAggLimit',
  'cglOtherLimitAmount',

  // ACORD 25 — Auto / Umbrella / Workers Comp / Other
  'combinedSingleLimit',
  'bodilyInjuryPerPersonLimit',
  'bodilyInjuryPerAccidentLimit',
  'propertyDamageLimit',
  'autoLiabilityBlankLimit',
  'retentionAmount',
  'umbrellaEachOccurrenceLimit',
  'umbrellaAggregateLimit',
  'umbrellaBlankLimit',
  'workersCompEachAccidentLimit',
  'workersCompDiseaseEachEmployeeLimit',
  'workersCompDiseasePolicyLimit',
  'otherInsuranceEachAccidentLimit',
  'otherInsuranceDiseaseEachEmployeeLimit',
  'otherInsuranceDiseasePolicyLimit',

  // ACORD 30 — Garage / Garage Keepers
  'autoOnlyLimit',
  'eachAccidentLimit',
  'aggregateLimit',
  'garageKeepersCompOtcLimit',
  'garageKeepersSpecifiedPerilsLimit',
  'garageKeepersCollisionLimit',
  'garageKeepersLocLimit',

  // ACORD 30 — General Liability / Umbrella / Workers Comp / Other
  'generalLiabilityEachOccurrenceLimit',
  'personalAdvInjuryLimit',
  'umbrellaExcessDeductibleRetentionAmount',
  'umbrellaExcessEachOccurrenceLimit',
  'umbrellaExcessAggregateLimit',
  'umbrellaExcessOtherLimit',
  'wcElDiseaseEachEmployeeLimit',
  'wcElDiseasePolicyLimit',
  'otherInsuranceLimits',
] as const

const COI_MONEY_FIELD_ID_SET = new Set<string>(COI_MONEY_FIELD_IDS)
const COI_MONEY_FIELDS_WITH_VALUE_DOLLAR = new Set<string>([
  'otherInsuranceLimits',
])
const COI_ZERO_ALLOWED_MONEY_FIELD_IDS = new Set([
  'retentionAmount',
  'umbrellaExcessDeductibleRetentionAmount',
])
const WHOLE_US_AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const DECIMAL_US_AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * True if `fieldId` is one of the ACORD code cells whose AcroForm widget
 * is a text field but whose semantic value is binary (`Y` / empty).
 */
export function isYnCodeFieldId(fieldId: string): boolean {
  return COI_YN_CODE_FIELD_ID_SET.has(fieldId)
}

export function isCoiMoneyFieldId(fieldId: string): boolean {
  return COI_MONEY_FIELD_ID_SET.has(fieldId)
}

/**
 * Unicode punctuation that pdf-lib cannot encode when regenerating
 * AcroForm appearances with `StandardFonts.Helvetica` (WinAnsi).
 * Common ingress: Word/Outlook paste, LLM extraction, portal copy
 * (`back‑up` with U+2011 non-breaking hyphen). Prod incident: company
 * 39004 COI drafts failed download/email with
 * `WinAnsi cannot encode "‑" (0x2011)`.
 */
const PDF_PUNCTUATION_REPLACEMENTS: Readonly<Record<number, string>> = {
  0x00a0: ' ', // no-break space
  0x00ad: '', // soft hyphen
  0x2009: ' ', // thin space
  0x200b: '', // zero-width space
  0x200c: '', // zero-width non-joiner
  0x200d: '', // zero-width joiner
  0x2010: '-', // hyphen
  0x2011: '-', // non-breaking hyphen
  0x2012: '-', // figure dash
  0x2013: '-', // en dash
  0x2014: '-', // em dash
  0x2018: "'", // left single quote
  0x2019: "'", // right single quote
  0x201c: '"', // left double quote
  0x201d: '"', // right double quote
  0x2022: '-', // bullet
  0x2026: '...', // horizontal ellipsis
  0x202f: ' ', // narrow no-break space
  0x2122: '(TM)', // trade mark sign
  0x2212: '-', // minus sign
  0xfeff: '', // BOM / zero-width no-break space
}

/**
 * Rewrite PDF-hostile Unicode to WinAnsi-safe ASCII. Idempotent for
 * already-clean strings. Exported for unit tests and any caller that
 * needs to sanitize before persisting `field_values`.
 */
export function normalizePdfEncodableText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    const replacement = PDF_PUNCTUATION_REPLACEMENTS[cp]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    if (
      (cp >= 0x20 && cp <= 0x7e) ||
      cp === 0x09 ||
      cp === 0x0a ||
      cp === 0x0d ||
      (cp >= 0xa0 && cp <= 0xff)
    ) {
      out += ch
    }
  }
  return out
}

export function normalizeCoiMoneyFieldValue(value: unknown, fieldId?: string): string {
  const raw = normalizeFieldValue(value).trim()
  if (!raw) return ''

  const lowered = raw.toLowerCase()
  // Products/Comp Ops often prints "Included" (in the general aggregate).
  // Never coerce those words into a dollar amount (Tanya 2026-07-28).
  if (
    lowered === 'included' ||
    lowered === 'incl' ||
    lowered === 'incl.' ||
    /^included\b/.test(lowered) ||
    /^incl\.?\s+in\b/.test(lowered)
  ) {
    return 'Included'
  }
  if (lowered === 'excluded' || lowered === 'excl' || /^excluded\b/.test(lowered)) {
    return 'Excluded'
  }
  if (lowered === 'n/a' || lowered === 'na') return raw

  const numeric = raw.replace(/^\$\s*/, '').replace(/,/g, '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return raw

  const amount = Number(numeric)
  if (!Number.isFinite(amount) || amount < 0) return ''
  if (amount === 0 && (!fieldId || !COI_ZERO_ALLOWED_MONEY_FIELD_IDS.has(fieldId))) return ''
  const formatted = Number.isInteger(amount)
    ? WHOLE_US_AMOUNT_FORMATTER.format(amount)
    : DECIMAL_US_AMOUNT_FORMATTER.format(amount)
  return !fieldId || COI_MONEY_FIELDS_WITH_VALUE_DOLLAR.has(fieldId) ? `$${formatted}` : formatted
}

/**
 * Several ACORD fields are named `...Checkbox` but are declared as `text`
 * type in the schema because the underlying AcroForm cell expects a `Y`/`N`
 * code (e.g. `CertificateOfInsurance_AdditionalInsuredCode_A`, the ADDL INSD
 * and SUBR WVD columns). When upstream mappers hand these a literal string
 * `"true"`/`"false"`, the PDF renders `"tru"` truncated inside the ~18pt cell.
 *
 * Normalize: truthy → `"Y"`, falsy → `""`; known money fields are
 * comma-formatted, with `$` included only for cells where the PDF does not
 * already print one. Dates are normalized below. Names and policy numbers
 * pass through.
 *
 * The expanded truthy set covers prod's heterogeneous AI/SUBR
 * representations (`"true"`, `"X"`, `"x"`, `"Y"`, `"y"`, `"  Y  "`,
 * `"yes"`, `"on"`, `"checked"`) — see SQL audit on
 * `insurance.generated_certificates` 2026-04 confirming all of these
 * appear in the same column.
 */
export function normalizeTextFieldValue(value: unknown, fieldId?: string): string {
  const normalized = normalizeFieldValue(value)
  const lowered = normalized.trim().toLowerCase()

  // Y/N code cells: collapse every truthy-ish encoding to the canonical
  // single letter `Y`. We do this for any field whose ID is on the
  // allow-list AND for any value that matches the `true`/`false`
  // sentinels regardless of field ID, so legacy callers that still
  // emit `"true"` for non-listed cells get the same rendering they
  // had before.
  if (fieldId && isYnCodeFieldId(fieldId)) {
    return isTruthyCheckboxValue(normalized) ? 'Y' : ''
  }
  if (lowered === 'true') return 'Y'
  if (lowered === 'false') return ''
  if (fieldId && isCoiMoneyFieldId(fieldId)) {
    return normalizePdfEncodableText(normalizeCoiMoneyFieldValue(normalized, fieldId))
  }
  return normalizePdfEncodableText(normalizeDateLikeString(normalized))
}

/**
 * ACORD date cells (Policy Eff / Policy Exp / Certificate Date) are
 * narrow — the header explicitly labels them `(MM/DD/YYYY)`. Upstream
 * data sometimes arrives as ISO (`2026-04-10`) or RFC-3339
 * (`2026-04-10T00:00:00Z`), which then truncates inside the cell to
 * something like `2026-04-`. This is a client-side safety net on top
 * of Hercules' `_format_date`: if a value looks like a real calendar
 * date in any common shape, rewrite it to `MM/DD/YYYY`. Anything that
 * doesn't confidently parse as a date is returned untouched so policy
 * numbers, names, etc. are never mangled.
 *
 * Exported for unit testing.
 */
export function normalizeDateLikeString(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw

  // Reject anything with characters other than digits / separators so
  // we don't accidentally reformat policy numbers like `2026-ABC-123`
  // or addresses that contain digits + dashes.
  if (!/^[\d/\-.T:Z+\s]+$/.test(trimmed)) return raw

  // ISO / RFC-3339 year-first (`YYYY-MM-DD`, optionally with a time
  // component). Captures the date portion only.
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (iso) {
    const [, y, m, d] = iso
    const formatted = toMmDdYyyy(y, m, d)
    if (formatted) return formatted
  }

  // Year-first with slashes (`YYYY/MM/DD`) — less common, included
  // defensively because some export pipelines use it.
  const isoSlash = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (isoSlash) {
    const [, y, m, d] = isoSlash
    const formatted = toMmDdYyyy(y, m, d)
    if (formatted) return formatted
  }

  return raw
}

function toMmDdYyyy(year: string, month: string, day: string): string | null {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  if (y < 1900 || y > 2100) return null
  if (m < 1 || m > 12) return null
  if (d < 1 || d > 31) return null
  const mm = String(m).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${mm}/${dd}/${y}`
}

/**
 * Safe for any `unknown` caller (Prisma `Date | null`, form inputs, Opal
 * field_values, legacy strings). Non-date-like inputs are returned as an
 * empty string so UI/email/PDF consumers can render without conditional
 * formatting.
 *
 * This is the single normalization choke point for COI dates. Use it at
 * every seam that crosses from "database / form input" to "what the user
 * or carrier sees" (editor preview, email body, PDF fill, UI banner).
 */
export function coerceDateToMmDdYyyy(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(value.getUTCDate()).padStart(2, '0')
    const yyyy = value.getUTCFullYear()
    return `${mm}/${dd}/${yyyy}`
  }
  const raw = String(value).trim()
  if (!raw) return ''
  const normalized = normalizeDateLikeString(raw)
  // Already-formatted MM/DD/YYYY passes through untouched; anything that
  // didn't parse as a date returns the original string (don't mangle e.g.
  // a hand-entered "TBD").
  return normalized
}

/**
 * Canonical schema field ID for the COI's "DATE (MM/DD/YYYY)" header
 * cell (top-right corner of every ACORD 25 / ACORD 30). Exported so
 * generators can stamp it without typing the raw string.
 */
export const COI_CERTIFICATE_DATE_FIELD_ID = 'certificateDate'

/**
 * Format a date as MM/DD/YYYY in America/New_York time.
 *
 * Why ET specifically: Harper is an East-coast brokerage; every
 * customer-facing date stamp on a Harper-issued COI is interpreted in
 * the operator team's local time. The default `Date.toLocale*` family
 * uses the host server's TZ, which on our cloud workers is UTC. At
 * 11:30pm ET the raw UTC date is already TOMORROW — so a cert
 * generated near midnight Eastern would print a date that's a day
 * ahead of when ops actually issued it. Hercules's `extract-v2`
 * (`opal_extraction_service_v2._map_acord25` stamps `date.today()` on
 * the Hercules container, which is also UTC) has the same problem,
 * so we can't rely on the extracted value either.
 *
 * Force `America/New_York` via `Intl.DateTimeFormat` and we get a
 * consistent ET MM/DD/YYYY regardless of where the workload runs.
 * The formatter handles DST transitions automatically (no need to
 * track EDT vs EST manually).
 *
 * NOTE: BB doesn't auto-apply this — historical re-renders should
 * preserve the original cert's date. Fresh generates (completionToFieldValues)
 * set it once at compose time; re-issue / open paths keep the stored value.
 * Callers that need today's stamp set
 * `fieldValues[COI_CERTIFICATE_DATE_FIELD_ID] =
 * formatCertificateDateInEasternTime()` before calling
 * `fillCoiPdfForm`.
 *
 * Pure / no I/O / no side effects. Default `now=new Date()` so
 * tests can inject a fake clock without changing the production
 * callsite ergonomics.
 */
export function formatCertificateDateInEasternTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(now)
}

/**
 * The vendored ACORD 25 template attaches DateV() validate actions that reject
 * an empty cell ("must be MM/DD/YYYY"). Operators need to CLEAR a wrong date
 * before typing the right one — strip only those DateV validate actions and
 * leave YesNo keystroke/validate handlers alone.
 */
export function stripDateFieldValidationActions(pdfDoc: PDFDocument): void {
  for (const field of pdfDoc.getForm().getFields()) {
    const dict = field.acroField.dict
    const aa = dict.lookup(PDFName.of('AA'))
    if (!(aa instanceof PDFDict)) continue
    const validate = aa.lookup(PDFName.of('V'))
    if (!(validate instanceof PDFDict)) continue
    const js = validate.lookup(PDFName.of('JS'))
    const jsText = js ? String(js) : ''
    if (!/DateV/i.test(jsText)) continue
    aa.delete(PDFName.of('V'))
    const remaining = [...aa.keys()]
    if (remaining.length === 0) dict.delete(PDFName.of('AA'))
  }
}

/**
 * Field IDs across `public/forms/acord25-schema.json` and
 * `public/forms/acord30-schema.json` whose cells render as calendar
 * dates. We keep an explicit allow-list (rather than running every
 * string through `coerceDateToMmDdYyyy`) so a stray ISO-looking token
 * inside a description or additional-insured blob — e.g. `"Project:
 * 2026-04-10 kickoff"` — isn't silently rewritten into `"04/10/2026"`
 * mid-sentence.
 *
 * IMPORTANT: These IDs MUST match the schemas exactly. Hercules emits
 * these same IDs from `opal_extraction_service_v2._map_acord25` /
 * `_map_acord30`. Drift here previously caused the editor preview to
 * display raw ISO for coverages whose IDs weren't listed (the PDF fill
 * path still rescues dates via `normalizeDateLikeString` inside
 * `normalizeTextFieldValue`, but the editor reads straight from
 * `fieldValues[fieldId]`). A regression test in
 * `src/tests/lib/company/coi-pdf.test.ts` asserts this list is a
 * superset of every schema field whose ID ends in `Date`.
 */
const COI_DATE_FIELD_IDS = [
  // Shared across both ACORD 25 and ACORD 30.
  'certificateDate',
  // `workersComp*` and `otherInsurance*` appear in both schemas with
  // identical IDs; listing them once covers both forms.
  'workersCompPolicyEffectiveDate',
  'workersCompPolicyExpirationDate',
  'otherInsurancePolicyEffectiveDate',
  'otherInsurancePolicyExpirationDate',

  // ACORD 25 – coverage rows (General Liability / Auto / Umbrella).
  'cglPolicyEffectiveDate',
  'cglPolicyExpirationDate',
  'autoPolicyEffectiveDate',
  'autoPolicyExpirationDate',
  'umbrellaPolicyEffectiveDate',
  'umbrellaPolicyExpirationDate',

  // ACORD 30 (Certificate of Liability Insurance – garage dealer):
  // top-level deal dates (Row A — Garage Liability — reuses these),
  // used by the email template and by the post-bind flow's
  // `activeDeal` override.
  'policyEffectiveDate',
  'policyExpirationDate',

  // ACORD 30 – coverage rows that DO have their own date cells:
  // Garage Keepers (Row B), General Liability (Row C), Excess /
  // Umbrella (Row E). Note there is no `garageLiabilityPolicy*Date` —
  // Row A (Garage Liability) on ACORD 30 reuses the top-level
  // `policyEffectiveDate` / `policyExpirationDate` above.
  'garageKeepersPolicyEffectiveDate',
  'garageKeepersPolicyExpirationDate',
  'generalLiabilityPolicyEffectiveDate',
  'generalLiabilityPolicyExpirationDate',
  'umbrellaExcessPolicyEffectiveDate',
  'umbrellaExcessPolicyExpirationDate',
] as const

/**
 * Normalize every known date + Y/N-code field in a COI `fieldValues`
 * record to canonical form. Idempotent; safe to call at any boundary.
 * Unknown fields pass through untouched so this can be applied blindly
 * before handing values to `fillCoiPdfForm`, the editor preview, email
 * templates, or persisting back to Hercules.
 *
 * - Date fields: rewritten to MM/DD/YYYY (see `COI_DATE_FIELD_IDS`).
 * - Money fields: comma-formatted. Most ACORD cells already print `$`; only
 *   the bottom Other Policy/extra section includes `$` in the value.
 * - Y/N code fields (ADDL INSD, SUBR WVD): collapsed to `"Y"` or `""`
 *   (see `COI_YN_CODE_FIELD_IDS`). Removes the prod data heterogeneity
 *   where the same column had `"true"`, `"X"`, `"x"`, `"  Y "`, etc.
 */
export function normalizeCoiFieldValues(
  values: Record<string, string>,
): Record<string, string> {
  const next = withCoiProducerDefaults(values)
  for (const fieldId of COI_MONEY_FIELD_IDS) {
    if (!(fieldId in next)) continue
    next[fieldId] = normalizeCoiMoneyFieldValue(next[fieldId], fieldId)
  }
  for (const fieldId of COI_DATE_FIELD_IDS) {
    const current = next[fieldId]
    if (!current) continue
    const coerced = coerceDateToMmDdYyyy(current)
    if (coerced) next[fieldId] = coerced
  }
  for (const fieldId of COI_YN_CODE_FIELD_IDS) {
    if (!(fieldId in next)) continue
    next[fieldId] = isTruthyCheckboxValue(next[fieldId]) ? 'Y' : ''
  }
  for (const fieldId of Object.keys(next)) {
    const current = next[fieldId]
    if (current) next[fieldId] = normalizePdfEncodableText(current)
  }
  return next
}

/**
 * Custom checkbox appearance provider that draws an "X" cross mark
 * instead of pdf-lib's default ZapfDingbats checkmark (✓). ACORD forms
 * use an X to indicate checked coverage, and carriers / certificate
 * holders expect this industry convention.
 *
 * The ACORD template background already contains the printed checkbox
 * borders, so we only draw the cross lines for the ON state and leave
 * the OFF state empty.
 */
function crossMarkCheckBoxProvider(
  _checkBox: PDFCheckBox,
  widget: PDFWidgetAnnotation,
): { on: PDFOperator[]; off: PDFOperator[] } {
  const { width, height } = widget.getRectangle()

  const inset = Math.min(width, height) * 0.2
  const thickness = Math.max(1.2, Math.min(width, height) * 0.12)

  return {
    on: [
      pushGraphicsState(),
      setLineWidth(thickness),
      setLineCap(LineCapStyle.Round),
      setStrokingColor(rgb(0, 0, 0)),
      moveTo(inset, inset), lineTo(width - inset, height - inset),
      moveTo(inset, height - inset), lineTo(width - inset, inset),
      stroke(),
      popGraphicsState(),
    ],
    off: [],
  }
}

/**
 * Strip every embedded AcroForm JavaScript action from the document — the
 * ACORD templates ship field-level `/AA` validate/format scripts (`DateV`,
 * `AFDate_Format`, …) that PDF viewers execute on edit, throwing blocking
 * alerts like "The date must be of the format MM/DD/YYYY." (operator report,
 * 2026-07-29). Our own fill normalizes dates/codes server-side
 * (`normalizeCoiFieldValues`), so these gates only ever block the operator.
 * Removes: per-field and per-widget `/AA`, the catalog's `/AA` and `/Names ›
 * /JavaScript` tree, and a JavaScript `/OpenAction`. Exported for tests.
 */
export function stripAcroFormJavaScript(pdfDoc: PDFDocument): void {
  const AA = PDFName.of('AA')
  try {
    for (const field of pdfDoc.getForm().getFields()) {
      field.acroField.dict.delete(AA)
      for (const widget of field.acroField.getWidgets()) {
        widget.dict.delete(AA)
      }
    }
  } catch {
    // A document with no AcroForm has nothing to strip.
  }
  pdfDoc.catalog.delete(AA)
  const names = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  names?.delete(PDFName.of('JavaScript'))
  const openAction = pdfDoc.catalog.lookupMaybe(PDFName.of('OpenAction'), PDFDict)
  if (openAction?.get(PDFName.of('S'))?.toString() === '/JavaScript') {
    pdfDoc.catalog.delete(PDFName.of('OpenAction'))
  }
}

// Exported for the outbound PDF lock (pdf-flatten.ts): the send-path flatten
// applies the same finishing stroke this file's own flatten applies, so a
// locked document never carries a leftover interactive widget.
export function removeResidualWidgetAnnotations(pdfDoc: PDFDocument): void {
  for (const page of pdfDoc.getPages()) {
    const annotations = page.node.Annots()
    if (!annotations) continue

    const annotationIndexesToRemove: number[] = []

    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = pdfDoc.context.lookupMaybe(annotations.get(index), PDFDict)
      const subtype = annotation?.get(PDFName.of('Subtype'))?.toString()

      if (!annotation || subtype === '/Widget') {
        annotationIndexesToRemove.push(index)
      }
    }

    for (const index of annotationIndexesToRemove.reverse()) {
      annotations.remove(index)
    }
  }
}

function alignWidgetRectangles(pdfDoc: PDFDocument, formSchema: CoiPdfFormSchema): void {
  const form = pdfDoc.getForm()
  const pages = pdfDoc.getPages()

  for (const fieldDef of formSchema.fields) {
    if (!fieldDef.rect || !fieldDef.field_name) continue

    const page = pages[fieldDef.page_number]
    if (!page) continue

    try {
      const pdfField = form.getField(fieldDef.field_name)
      for (const widget of pdfField.acroField.getWidgets()) {
        widget.setRectangle({
          x: fieldDef.rect.x,
          y: page.getHeight() - fieldDef.rect.y - fieldDef.rect.height,
          width: fieldDef.rect.width,
          height: fieldDef.rect.height,
        })
      }
    } catch {
      // Some schema fields may not exist in the underlying AcroForm.
    }
  }
}

interface UnmappedFieldRecord {
  fieldId: string
  fieldName: string
  reason: 'missing_widget' | 'wrong_field_type'
}

function applyFieldValue(
  pdfDoc: PDFDocument,
  fieldDef: CoiPdfSchemaField,
  fieldValues: Record<string, string>,
  unmapped: UnmappedFieldRecord[],
): void {
  const form = pdfDoc.getForm()
  const rawValue = fieldValues[fieldDef.field_id] ?? fieldValues[fieldDef.field_name] ?? ''

  let pdfField: ReturnType<typeof form.getField>
  try {
    pdfField = form.getField(fieldDef.field_name)
  } catch {
    if (String(rawValue).trim()) {
      // Schema declared a field with no matching AcroForm widget. We
      // surface this so schema drift (or upstream mappers writing to
      // phantom fields) doesn't fail silently in production.
      unmapped.push({
        fieldId: fieldDef.field_id,
        fieldName: fieldDef.field_name,
        reason: 'missing_widget',
      })
    }
    return
  }

  if (fieldDef.type === 'checkbox') {
    if (pdfField instanceof PDFCheckBox) {
      if (isTruthyCheckboxValue(rawValue)) pdfField.check()
      else pdfField.uncheck()
      return
    }
    // Some checkbox-style schema fields map to text widgets in legacy
    // ACORD templates; preserve the previous Y/blank behavior there.
    if (pdfField instanceof PDFTextField) {
      pdfField.setText(isTruthyCheckboxValue(rawValue) ? 'Y' : '')
      return
    }
    if (String(rawValue).trim()) {
      unmapped.push({
        fieldId: fieldDef.field_id,
        fieldName: fieldDef.field_name,
        reason: 'wrong_field_type',
      })
    }
    return
  }

  if (pdfField instanceof PDFTextField) {
    try {
      pdfField.setText(normalizeTextFieldValue(rawValue, fieldDef.field_id))
    } catch {
      if (String(rawValue).trim()) {
        unmapped.push({
          fieldId: fieldDef.field_id,
          fieldName: fieldDef.field_name,
          reason: 'wrong_field_type',
        })
      }
    }
    return
  }

  if (String(rawValue).trim()) {
    unmapped.push({
      fieldId: fieldDef.field_id,
      fieldName: fieldDef.field_name,
      reason: 'wrong_field_type',
    })
  }
}

export interface FillCoiPdfFormResult {
  pdfBytes: Uint8Array
  /**
   * Logical field IDs whose non-empty value could not be written to the
   * underlying AcroForm. Used by callers to log/telemetry schema drift
   * without spamming console output for every empty field.
   */
  unmappedFields: UnmappedFieldRecord[]
  /**
   * THE DESCRIPTION-BOX FIT PLAN (Tanya's 7/9 finding #6): how the
   * description-of-operations box was sized on this fill — the font stepped
   * down until the text fit, and `fits: false` means it STILL overflows at
   * the floor (the caller warns / the pre-send gate flags; the box is never
   * silently cut). Null when the form carries no description field or the
   * description is empty.
   */
  descriptionFit: DescriptionFitPlan | null
}

export async function fillCoiPdfForm(
  templatePdfBytes: ArrayBuffer | Uint8Array,
  fieldValues: Record<string, string>,
  formSchema: CoiPdfFormSchema,
  options: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  const result = await fillCoiPdfFormWithReport(templatePdfBytes, fieldValues, formSchema, options)
  return result.pdfBytes
}

/**
 * Like `fillCoiPdfForm` but additionally returns a report of any
 * non-empty values that could not be written. Use this from server
 * routes / instrumentation that want to log schema drift; the
 * thin `fillCoiPdfForm` wrapper above keeps the existing client API
 * (returns just bytes) untouched.
 */
export async function fillCoiPdfFormWithReport(
  templatePdfBytes: ArrayBuffer | Uint8Array,
  fieldValues: Record<string, string>,
  formSchema: CoiPdfFormSchema,
  options: { flatten?: boolean } = {},
): Promise<FillCoiPdfFormResult> {
  // Harper's operator DOWNLOAD flattens (final, locked cert). Our in-app review
  // pane wants the SAME fill but left editable (like BigBrother's editor), so
  // callers may pass { flatten: false } to keep the AcroForm fields editable.
  const flatten = options.flatten !== false
  const valuesWithProducerDefaults = withCoiProducerDefaults(fieldValues)

  const pdfDoc = await PDFDocument.load(templatePdfBytes)
  // No editing gates ride a Harper-generated certificate: the template's own
  // per-field JavaScript (date-format alerts and friends) dies here, on the
  // flattened AND the editable render alike.
  stripAcroFormJavaScript(pdfDoc)
  alignWidgetRectangles(pdfDoc, formSchema)
  // Allow clearing date cells in the editable review fill (DateV rejects "").
  stripDateFieldValidationActions(pdfDoc)

  const unmapped: UnmappedFieldRecord[] = []
  for (const fieldDef of formSchema.fields) {
    applyFieldValue(pdfDoc, fieldDef, valuesWithProducerDefaults, unmapped)
  }

  if (unmapped.length > 0 && typeof console !== 'undefined') {
    // Non-fatal: log so silent data loss caused by schema drift surfaces
    // in dev/CI logs and Sentry instead of only as customer reports.
    console.warn(
      '[coi-pdf] fillCoiPdfFormWithReport dropped values for unmappable fields',
      { formId: formSchema.form_id, unmapped },
    )
  }

  const form = pdfDoc.getForm()
  let descriptionFit: DescriptionFitPlan | null = null
  if (form.getFields().length > 0) {
    // Manually regenerate appearances for each field type so we
    // control what mark checkboxes render. Using
    // `flatten({ updateFieldAppearances: true })` would internally
    // call `defaultUpdateAppearances()` on every PDFCheckBox, which
    // unconditionally overwrites our custom X marks with pdf-lib's
    // default ZapfDingbats checkmark (✓).
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    // THE DESCRIPTION-BOX AUTO-FIT (Tanya's 7/9 finding #6): the description
    // of operations steps its font down until the text fits its own schema
    // rect — measured with the REAL embedded Helvetica metrics — and the
    // plan rides the result so a still-overflowing description WARNS and
    // FLAGS instead of printing cut off. Runs before appearance regeneration
    // so the appearances render at the fitted size.
    descriptionFit = applyDescriptionAutoFit(pdfDoc, formSchema, valuesWithProducerDefaults, (t, s) => font.widthOfTextAtSize(t, s))
    for (const field of form.getFields()) {
      if (field instanceof PDFTextField) {
        field.updateAppearances(font)
      } else if (field instanceof PDFCheckBox) {
        field.updateAppearances(crossMarkCheckBoxProvider)
      }
    }
    if (flatten) {
      // The appearances above are ours, but a template's own untouched widgets
      // (radios, dropdowns, anything this loop leaves alone) still carry the
      // vendor's streams — and flatten mounts those on the page, where a
      // missing /Subtype makes a conforming renderer skip them. Stamp before
      // mounting. See pdf-flatten.ts for the incident this class caused.
      stampWidgetAppearanceSubtypes(form)
      form.flatten({ updateFieldAppearances: false })
      removeResidualWidgetAnnotations(pdfDoc)
    }
  }

  // Only strip the AcroForm dict when flattening — an editable copy must keep it
  // so the reviewer can still edit the fields in the viewer.
  if (flatten) {
    pdfDoc.catalog.delete(PDFName.of('AcroForm'))
  }

  return {
    pdfBytes: new Uint8Array(await pdfDoc.save()),
    unmappedFields: unmapped,
    descriptionFit,
  }
}

// Size the description-of-operations box from its own schema rect and set the
// field's font size to the plan's answer. Pure decision (acord25-descfit) +
// one pdf-lib write; a form without the field (or an empty description)
// answers null and touches nothing. Never throws — a sizing failure keeps the
// template's own default rendering rather than breaking the fill.
function applyDescriptionAutoFit(
  pdfDoc: PDFDocument,
  formSchema: CoiPdfFormSchema,
  fieldValues: Record<string, string>,
  widthOfText: (text: string, fontSize: number) => number,
): DescriptionFitPlan | null {
  // Matched by PREFIX so every form's description box gets the same law:
  // the ACORD 25's `descriptionOfOperations` and the ACORD 30's
  // `descriptionOfOperationsLocationsVehicles` both auto-fit (the Bugbot
  // catch on the form-type seam: a garage certificate's description must
  // not print cut off either).
  const fieldDef = formSchema.fields.find((f) => f.field_id.startsWith(DESCRIPTION_FIELD_ID))
  if (!fieldDef?.rect || !fieldDef.field_name) return null
  const raw = fieldValues[fieldDef.field_id] ?? fieldValues[fieldDef.field_name] ?? ''
  // The same normalization the fill applied — the plan measures what prints.
  const printed = normalizeTextFieldValue(raw, fieldDef.field_id)
  if (!printed.trim()) return null
  try {
    const plan = descriptionFitPlan(printed, {
      box: { width: fieldDef.rect.width, height: fieldDef.rect.height },
      widthOfText,
    })
    const pdfField = pdfDoc.getForm().getField(fieldDef.field_name)
    if (pdfField instanceof PDFTextField) pdfField.setFontSize(plan.fontSize)
    return plan
  } catch {
    return null
  }
}

export function downloadPdfBlob(pdfBytes: Uint8Array, filename: string): void {
  const arrayBuffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(arrayBuffer).set(pdfBytes)
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
