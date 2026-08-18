/**
 * IQ Stage filter axis — `public.orders_temp.tag` (order-level).
 *
 * Vocabulary and labels are the measured BigBrother/HTA Step axis
 * (harper-coi-workbench bind-order-steps), not invented here. Gate is a
 * different field (`service_workbench_gate_overrides`) and must not reuse
 * these labels.
 */

export const IQ_STAGE_NO_STATUS = "step:none";
export const IQ_STAGE_UNRECOGNIZED = "step:other";

export const IQ_STAGE_NO_STATUS_LABEL = "No status";
export const IQ_STAGE_UNRECOGNIZED_LABEL = "Step not recognized";

/** Declared live tags in bind-flow order (HTA playbook). */
export const IQ_STAGE_TAG_IDS = [
  "instant_quote_needs_bound",
  "create_binder",
  "create_binder_dont_send",
  "binder_pending_risk",
  "bind_requested",
  "awaiting_binder",
  "binder_received",
  "not_bound_subjectivity",
  "application_built",
  "application_sent",
  "signing_in_progress",
] as const;

export type IqStageTagId = (typeof IQ_STAGE_TAG_IDS)[number];

export const IQ_STAGE_TAG_LABELS: Record<IqStageTagId, string> = {
  instant_quote_needs_bound: "Instant quote needs bound",
  create_binder: "Create binder",
  create_binder_dont_send: "Create binder, don't send",
  binder_pending_risk: "Binder pending risk",
  bind_requested: "Bind requested",
  awaiting_binder: "Awaiting binder",
  binder_received: "Binder received",
  not_bound_subjectivity: "Not bound — subjectivity",
  application_built: "Application built",
  application_sent: "Application sent",
  signing_in_progress: "Signing in progress",
};

/** Filter option ids: No status + declared tags (+ unrecognized when filtering). */
export type IqStageFilterId = typeof IQ_STAGE_NO_STATUS | IqStageTagId | typeof IQ_STAGE_UNRECOGNIZED;

export type IqStageOption = {
  id: IqStageFilterId;
  label: string;
};

/** Popover options in pipeline order, No status first. */
export const IQ_STAGE_FILTER_OPTIONS: readonly IqStageOption[] = [
  { id: IQ_STAGE_NO_STATUS, label: IQ_STAGE_NO_STATUS_LABEL },
  ...IQ_STAGE_TAG_IDS.map((id) => ({
    id,
    label: IQ_STAGE_TAG_LABELS[id],
  })),
];

const DECLARED_TAG_SET = new Set<string>(IQ_STAGE_TAG_IDS);
const FILTER_ID_SET = new Set<string>([
  IQ_STAGE_NO_STATUS,
  ...IQ_STAGE_TAG_IDS,
  IQ_STAGE_UNRECOGNIZED,
]);
const IQ_STAGE_FILTER_ORDER: readonly IqStageFilterId[] = [
  IQ_STAGE_NO_STATUS,
  ...IQ_STAGE_TAG_IDS,
  IQ_STAGE_UNRECOGNIZED,
];

export type IqStageIdentity = {
  id: IqStageFilterId;
  label: string;
  /** False for No status and unrecognized. */
  declared: boolean;
};

/** Fold a raw `orders_temp.tag` into the filter/display identity. */
export function iqStageFromTag(raw: string | null | undefined): IqStageIdentity {
  const tag = (raw ?? "").trim();
  if (!tag) {
    return {
      id: IQ_STAGE_NO_STATUS,
      label: IQ_STAGE_NO_STATUS_LABEL,
      declared: false,
    };
  }
  const canonical = tag.toLowerCase();
  if (DECLARED_TAG_SET.has(canonical)) {
    return {
      id: canonical as IqStageTagId,
      label: IQ_STAGE_TAG_LABELS[canonical as IqStageTagId],
      declared: true,
    };
  }
  return {
    id: IQ_STAGE_UNRECOGNIZED,
    label: IQ_STAGE_UNRECOGNIZED_LABEL,
    declared: false,
  };
}

export function isIqStageFilterId(raw: string): raw is IqStageFilterId {
  return FILTER_ID_SET.has(raw);
}

/**
 * Parse `iqStage` URL param. Empty / missing → no stage filter (all stages).
 * Unknown tokens are dropped; only stable filter ids survive.
 */
export function parseIqStages(raw: string | null | undefined): IqStageFilterId[] {
  // Runtime shapes the page types don't promise (e.g. a repeated ?iqStage=
  // param arriving as an array) parse as no selection rather than throwing.
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<IqStageFilterId>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!isIqStageFilterId(id)) continue;
    seen.add(id);
  }
  return IQ_STAGE_FILTER_ORDER.filter((id) => seen.has(id));
}

/** Serialize selected stages for the URL. Empty → omit param. */
export function serializeIqStages(
  stages: readonly IqStageFilterId[],
): string | undefined {
  const canonical = IQ_STAGE_FILTER_ORDER.filter((id) => stages.includes(id));
  return canonical.length > 0 ? canonical.join(",") : undefined;
}

/** True when the stored tag column matches a selected filter id. */
export function orderMatchesIqStages(
  tag: string | null | undefined,
  selected: readonly IqStageFilterId[],
): boolean {
  if (selected.length === 0) return true;
  const stage = iqStageFromTag(tag);
  return selected.includes(stage.id);
}
