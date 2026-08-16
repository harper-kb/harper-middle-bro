import { identityForIssuingCompany, naicForPolicy } from "@/lib/certificates/naic";

// ── Carrier NAIC lookup ───────────────────────────────────────────────────────
// Deterministic only — never LLM-guessed. HTA resolved this against
// public.carriers over the prod SQL gateway; this repo has no gateway, so the
// live resolver reads the desk's own verified NAIC registry
// (src/lib/certificates/naic.ts — every code traces to a cited source).
// Blank when the name has no verified entry: an honest empty NAIC cell beats
// a guessed one. The pure ranking helpers below are ported unchanged.

const NAIC_RE = /^\d{5}$/;

/** Collapse free-form insurer text to the shared lookup alphabet. */
export function normalizeCarrierLookupName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/**
 * Canonical key for aliasing near-duplicates ("Atlantic Casualty Insurance"
 * vs "… Insurance Company"). Strips leading "the" and corporate suffixes.
 * (Distinct from coi-learning's hyphenated normalizeCarrierKey.)
 */
export function carrierNaicCanonicalKey(name: string): string {
  return normalizeCarrierLookupName(name)
    .replace(/^(the)\s+/g, "")
    .replace(/\b(insurance|company|corporation|incorporated|inc|corp|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: pick a NAIC only when every candidate agrees on one 5-digit code. */
export function pickUniqueCarrierNaic(
  rows: Array<{ naic?: string | number | null }>,
): string | null {
  const codes = new Set<string>();
  for (const row of rows) {
    const naic = row.naic == null ? "" : String(row.naic).trim();
    if (NAIC_RE.test(naic)) codes.add(naic);
  }
  if (codes.size !== 1) return null;
  return [...codes][0] ?? null;
}

type CarrierNaicRow = { name?: string; naic?: string | number | null };

/**
 * Pure ranking over a bounded carriers candidate set.
 * Exact → unique canonical-key (fail-closed on outside conflicts) → unique fuzzy.
 */
export function selectCarrierNaicFromRows(
  rows: CarrierNaicRow[],
  carrierName: string,
): string | null {
  const normalized = normalizeCarrierLookupName(carrierName);
  if (!normalized || !rows.length) return null;

  const exact = rows.filter(
    (r) => normalizeCarrierLookupName(r.name ?? "") === normalized,
  );
  const fromExact = pickUniqueCarrierNaic(exact);
  if (fromExact) return fromExact;

  const key = carrierNaicCanonicalKey(carrierName);
  if (key.length >= 4) {
    const byKey = rows.filter((r) => carrierNaicCanonicalKey(r.name ?? "") === key);
    const fromKey = pickUniqueCarrierNaic(byKey);
    if (fromKey) {
      // Fail closed: a broader fuzzy hit with a different 5-digit code means
      // the name family is ambiguous ("Example Carrier" vs "… Group").
      const outsideConflict = rows.some((r) => {
        if (carrierNaicCanonicalKey(r.name ?? "") === key) return false;
        const naic = r.naic == null ? "" : String(r.naic).trim();
        return NAIC_RE.test(naic) && naic !== fromKey;
      });
      if (outsideConflict) return null;
      return fromKey;
    }
  }

  if (normalized.length >= 8) {
    return pickUniqueCarrierNaic(rows);
  }
  return null;
}

/**
 * Resolve a 5-digit NAIC for an insurer name from the desk's verified NAIC
 * registry: the exact dec-page writing-company match first, then the brand
 * rules. No verified entry = null — the cell stays blank, never a guess.
 */
export async function resolveCarrierNaic(
  carrierName: string | null | undefined,
): Promise<string | null> {
  const name = (carrierName ?? "").trim();
  if (!name) return null;
  const identity = identityForIssuingCompany(name) ?? naicForPolicy(name);
  const naic = identity?.naic ?? null;
  return naic && NAIC_RE.test(naic) ? naic : null;
}

/**
 * Stamp public.carriers when unique: Insurer A on the legacy projection and
 * A-F only while the deterministic generator is enabled. Never overwrites a
 * non-empty NAIC cell. Idempotent.
 * `resolve` is injectable for unit tests (default = live public.carriers lookup).
 */
export async function ensureInsurerNaicOnFieldValues(
  fieldValues: Record<string, string>,
  resolve: (name: string | null | undefined) => Promise<string | null> = resolveCarrierNaic,
  options?: { deterministicGeneratorEnabled?: boolean },
): Promise<Record<string, string>> {
  const deterministicGeneratorEnabled =
    options?.deterministicGeneratorEnabled ??
    (process.env.COI_DETERMINISTIC_GENERATOR_ENABLED === "true");
  const slots = deterministicGeneratorEnabled ? "ABCDEF" : "A";
  const missing = slots.split("").flatMap((slot) => {
    const insurer = (fieldValues[`insurer${slot}Name`] ?? "").trim();
    const existing = (fieldValues[`insurer${slot}NaicNumber`] ?? "").trim();
    return insurer && !existing ? [{ slot, insurer }] : [];
  });
  if (!missing.length) return fieldValues;
  const resolved = await Promise.all(
    missing.map(async ({ slot, insurer }) => ({
      slot,
      naic: await resolve(insurer),
    })),
  );
  const fills = resolved.filter(
    (entry): entry is { slot: string; naic: string } =>
      typeof entry.naic === "string" && NAIC_RE.test(entry.naic),
  );
  if (!fills.length) return fieldValues;
  const next = { ...fieldValues };
  for (const { slot, naic } of fills) {
    next[`insurer${slot}NaicNumber`] = naic;
  }
  return next;
}
