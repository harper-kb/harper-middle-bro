"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { CertCheckResult } from "@/lib/cert-checks";
import {
  issueCertificateAction,
  prepareCertificateAction,
} from "@/lib/cert-issue";
import { CertChecksPanel } from "./CertChecksPanel";
import type {
  Acord25Sheet,
  CertFormDef,
  CertFormKey,
  LimitBoxDef,
  OtherRow,
  PlacementMap,
  ResolvedSection,
} from "@/lib/acord25";
import { CERT_FORMS, certDescription, resolveCertSheet } from "@/lib/acord25";
import { AUTHORIZED_REPRESENTATIVE, PRODUCER } from "@/lib/brand";
import { CARRIER_INTEL } from "@/lib/carriers";
import { coverageLabel, getRequestType } from "@/lib/catalog";
import {
  prepareRunEmails,
  type CertificateRun,
  type RunCertificate,
} from "@/lib/cert-run";
import {
  addCertHolderAction,
  correctPlacementAction,
  removeCertHolderAction,
  removePlacementRuleAction,
  updateCertHolderAction,
} from "@/lib/cert-studio-actions";
import {
  buildSuggestions,
  displayLimit,
  effBool,
  effStr,
  mdy,
  verifyEditedSheet,
  type FieldSuggestion,
  type SheetFinding,
  type SheetOverrides,
} from "@/lib/cert-review";
import {
  buildCertificatePacket,
  FLAG_REQUEST_TYPE,
  type CertificatePacket,
  type CertInsurer,
} from "@/lib/certificate";
import type { CoiFlags } from "@/lib/coi";
import { findEndorsement, type PolicyFormSet } from "@/lib/forms";
import { getGuidance, type PriceGuidance } from "@/lib/price-guidance";
import type { Account, Policy } from "@/lib/types";
import { CarrierLogo } from "./CarrierLogo";
import {
  AddressStatusChip,
  InsuredAddressChip,
  addressGateOpen,
  useAddressCheck,
  useInsuredAddressCheck,
  type Check,
} from "./ContactValidation";
import type { AddressVerdict } from "@/lib/validate-contact";
import { PriceGuidanceNote } from "./PriceGuidanceNote";

/**
 * Certificate Studio — a faithful, fully editable ACORD 25 (2025/12), plus
 * ACORD 30 (Certificate of Garage Insurance, 2016/03) when the account
 * carries garage-flavored coverage. Both render from the same descriptor
 * registry (`CERT_FORMS`); switching forms restarts the review pass.
 *
 * The sheet fills itself from the schedule of record, then review happens
 * ON the sheet. The guided confirm card groups every record-locked area
 * (Producer/Insured header, Insurers block, coverage sections, write-in
 * rows) into ONE "Confirm All From The File" step — those values are locked
 * to the record (see `isRecordField`), verifier-checked, and shown with
 * their sources, so a single attestation covers them. The two genuinely
 * per-certificate decisions — Certificate Holder and Description — confirm
 * individually. Every ACORD area still carries a slim `.no-print` review
 * strip for fine-grained review and reopening; editing inside a confirmed
 * area re-opens just that area. Every change re-runs the same deterministic
 * verifier that gates ticket certs, and the issue path is a hard state
 * machine: every area confirmed → verification clean → Sign & Issue (the
 * standard authorized-representative stamp applies with issuance) → print.
 */

type AreaState = "pending" | "active" | "confirmed";

/** Serializable view of a desk placement rule, resolved server-side. */
export interface PlacementRuleView {
  id: string;
  policyId: string;
  sectionKey: string;
  movedFrom: string | null;
  correctedBy: string;
  createdAt: string;
}

/** An open ticket that justifies unlocking coverage edits, resolved server-side. */
export interface EndorsementTicketView {
  id: string;
  label: string;
  status: string;
  subject: string;
}

/** A holder carried in from a request or record — never typed twice. */
export interface RailSourceHolder {
  name: string;
  address: string;
  /** Requester email off the ticket that asked, when one is on file */
  requesterEmail?: string | null;
  /** Where this holder came from, e.g. the ticket subject */
  detail?: string;
}

/** A desk-typed holder persisted in `desk_cert_holders`. */
export interface SavedHolderView {
  id: string;
  name: string;
  address: string;
}

/** One entry on the holder rail, whatever its source. */
interface RailEntry {
  key: string;
  name: string;
  address: string;
  source: "Ticket" | "AI Registry" | "Desk";
  requesterEmail: string | null;
  detail: string | null;
  /** Set for desk entries — unlocks edit-in-place and remove */
  savedId: string | null;
}

/** A certificate completed inside a run — snapshot of what was on the sheet. */
interface RunDoneCert {
  holderName: string;
  holderAddress: string;
  description: string;
  requesterEmail: string | null;
  signedOn: string;
  /** Ledger id — every run certificate went through the single send path */
  certId: string;
}

interface RunState {
  queue: RailEntry[];
  /** Index of the holder currently on the sheet; queue.length = run complete */
  idx: number;
  done: RunDoneCert[];
}

interface AreaDef {
  key: string;
  label: string;
}

const SECTION_AREA_KEYS = new Set(
  [...CERT_FORMS.acord25.sections, ...CERT_FORMS.acord30.sections].map(
    (d) => d.key,
  ),
);

/**
 * Schedule-of-record fields are locked: coverage rows (limits, policy
 * numbers, dates, coverage checkboxes) and the insurers block print exactly
 * what the paper says and cannot be typed over. The only exceptions inside
 * the grid are the ADDL INSD / SUBR WVD cells, which are per-certificate
 * assertions the verifier gates separately. Editing unlocks only while an
 * open endorsement ticket is changing conditions on this account.
 */
function isRecordField(id: string): boolean {
  if (id.endsWith(".addl") || id.endsWith(".subr")) return false;
  const area = fieldArea(id);
  if (!area) return false;
  return (
    area === "insurers" || SECTION_AREA_KEYS.has(area) || /^other\d+$/.test(area)
  );
}

/** Which review area a sheet field belongs to. null = free metadata field. */
function fieldArea(id: string): string | null {
  if (id === "desc" || id.startsWith("desc.")) return "desc";
  if (id.startsWith("holder.")) return "holder";
  if (id.startsWith("insurer.") || id.startsWith("naic.")) return "insurers";
  if (id.startsWith("producer.") || id.startsWith("insured.") || id === "date") {
    return "header";
  }
  const prefix = id.split(".")[0];
  if (SECTION_AREA_KEYS.has(prefix) || /^other\d+$/.test(prefix)) return prefix;
  return null;
}

interface SheetCtx {
  overrides: SheetOverrides;
  /** Field ids carrying a reject right now — red tint on screen */
  bad: Set<string>;
  /** True when this field is locked to the schedule of record */
  locked: (id: string) => boolean;
  setOverride: (id: string, v: string | boolean) => void;
  /** Area currently under review — its fields highlight */
  activeArea: string | null;
  confirmed: Set<string>;
  /** Extracted-field count per area, for the Review chip */
  counts: Record<string, number>;
  isArea: (key: string) => boolean;
  begin: (key: string) => void;
  confirm: (key: string) => void;
  reopen: (key: string) => void;
  cancel: () => void;
}

/** Screen tint for a field: reject beats review-highlight beats confirmed. */
function fieldTint(ctx: SheetCtx, id: string): string {
  if (ctx.bad.has(id)) return "is-bad";
  const area = fieldArea(id);
  if (area && area === ctx.activeArea) return "is-review";
  if (area && ctx.confirmed.has(area)) return "is-ok";
  return "";
}

export function CertificateStudio({
  account,
  policies,
  formSets,
  guidance,
  placements = {},
  placementRules = [],
  ticketHolders = [],
  registryHolders = [],
  savedHolders = [],
  endorsementTickets = [],
}: {
  account: Account;
  policies: Policy[];
  formSets: Record<string, PolicyFormSet>;
  guidance: Record<string, PriceGuidance>;
  /** Desk placement rules (policyId → section), resolved server-side */
  placements?: PlacementMap;
  placementRules?: PlacementRuleView[];
  /** Holders named on this account's tickets — most trusted rail source */
  ticketHolders?: RailSourceHolder[];
  /** Recorded additional insureds / prior cert holders on file */
  registryHolders?: RailSourceHolder[];
  /** Desk-typed holders persisted for this account */
  savedHolders?: SavedHolderView[];
  /** Open endorsement / exposure tickets that may unlock coverage edits */
  endorsementTickets?: EndorsementTicketView[];
}) {
  // Garage-flavored coverage unlocks the ACORD 30 — the purpose-built
  // certificate for garage risks (a plain 25 can't evidence garagekeepers).
  const hasGarage = policies.some(
    (p) =>
      p.coverages.some((c) => /garage|^GK$/i.test(c)) ||
      (formSets[p.id]?.coverages ?? []).some((c) => /garage/i.test(c.label)),
  );

  const [selected, setSelected] = useState<string[]>(policies.map((p) => p.id));
  const [formKey, setFormKey] = useState<CertFormKey>(
    hasGarage ? "acord30" : "acord25",
  );
  const [holderNameRaw, setHolderNameRaw] = useState("");
  const [holderAddressRaw, setHolderAddressRaw] = useState("");
  const [overrides, setOverrides] = useState<SheetOverrides>({});
  const [confirmedAreas, setConfirmedAreas] = useState<string[]>([]);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  // The guided confirm card opens on its own with the values extracted from
  // the file, area by area — closing it falls back to the on-sheet strips.
  const [wizardOpen, setWizardOpen] = useState(true);
  // Screen-only sheet magnification; print always renders at 100%.
  const [zoom, setZoom] = useState(1);
  // Coverage rows and the insurers block are locked to the schedule of
  // record. Unlocking requires citing an open endorsement ticket; relocking
  // drops any coverage edits so the sheet returns to what the paper says.
  const [unlockTicketId, setUnlockTicketId] = useState<string | null>(null);
  const unlockTicket =
    endorsementTickets.find((t) => t.id === unlockTicketId) ?? null;
  const coverageLocked = unlockTicket == null;

  // ——— Issuance state: the single send path ———
  // The sheet renders in SPECIMEN mode (diagonal watermark baked into the
  // artifact) until the server-side issuance function has run the canonical
  // check registry and recorded the certificate on the ledger — and only for
  // the exact inputs that were issued. Any edit after issuance is a new,
  // un-issued artifact and the watermark returns.
  const [issuing, startIssuance] = useTransition();
  const [issued, setIssued] = useState<{
    certId: string;
    digest: string;
    key: string;
    issuedAt: string;
  } | null>(null);
  const [checkResults, setCheckResults] = useState<CertCheckResult[] | null>(null);
  const [checkOverrides, setCheckOverrides] = useState<Record<string, string>>({});
  const [preparedInfo, setPreparedInfo] = useState<{
    id: string;
    expiresAt: string;
  } | null>(null);

  const form = CERT_FORMS[formKey];
  const chosen = policies.filter((p) => selected.includes(p.id));

  // The holder box reiterates the insured until someone says otherwise: the
  // everyday certificate is the insured's own evidence of coverage, so the
  // named insured, its street, and its city/state/ZIP are the right default.
  // Both fields stay editable — a rail holder or a typed name replaces this,
  // and clearing the field falls back here rather than to blank paper. The
  // values track the INSURED box, edits and verified address included, so
  // the two blocks can never disagree.
  const insuredNameDefault = chosen[0]?.quoteInsuredName ?? account.name;
  const insuredName = effStr(overrides, "insured.name", insuredNameDefault);
  const insuredAddress = [
    effStr(overrides, "insured.addr1", account.addressLine1 ?? ""),
    effStr(overrides, "insured.city", account.city ?? ""),
    `${effStr(overrides, "insured.state", account.state)} ${effStr(overrides, "insured.zip", account.zip ?? "")}`.trim(),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  const holderName = holderNameRaw.trim() ? holderNameRaw : insuredName;
  const holderAddress = holderAddressRaw.trim()
    ? holderAddressRaw
    : insuredAddress;

  // Holder-address hard gate. A typed address must come back verified (or
  // matched-with-standardization) before the holder area can be confirmed
  // or the certificate signed. Validator down = still blocked — Retry, not
  // pass-through. An empty holder address stays allowed: blank beats wrong.
  const holderCheck = useAddressCheck(holderAddress);
  const holderAddressOk = addressGateOpen(holderCheck);

  const packet = useMemo(
    () =>
      chosen.length
        ? buildCertificatePacket({
            account,
            policies: chosen,
            formSets,
            holderName,
            holderAddress,
          })
        : null,
    [account, chosen, formSets, holderName, holderAddress],
  );

  const sheet = useMemo(
    () => (packet ? resolveCertSheet(formKey, packet.sections, placements) : null),
    [packet, formKey, placements],
  );

  // A placement correction (or a revoked rule) moves rows — that's a
  // different sheet, so the review pass restarts, same as a policy-mix change.
  const placementsSig = JSON.stringify(placements);
  useEffect(() => {
    setOverrides({});
    setConfirmedAreas([]);
    setActiveArea(null);
    setSigned(false);
    setRun(null);
    setWizardOpen(true);
    setIssued(null);
    setCheckResults(null);
    setPreparedInfo(null);
  }, [placementsSig]);

  // Identity of the exact artifact on screen. The clean (non-specimen)
  // render exists only while this key matches what the ledger issued.
  const inputsKey = useMemo(
    () =>
      JSON.stringify([
        [...selected].sort(),
        formKey,
        holderName.trim(),
        holderAddress.trim(),
        overrides,
        placementsSig,
      ]),
    [selected, formKey, holderName, holderAddress, overrides, placementsSig],
  );
  const isIssuedRender = issued != null && issued.key === inputsKey;
  const specimen = !isIssuedRender;

  const suggestions = useMemo(
    () => (packet && sheet ? buildSuggestions(sheet, packet) : []),
    [packet, sheet],
  );

  const verdict = useMemo(
    () =>
      packet && sheet
        ? verifyEditedSheet({ account, packet, sheet, overrides })
        : { findings: [], rejects: [], warns: [] },
    [account, packet, sheet, overrides],
  );

  // ——— The review areas this sheet actually carries ———
  const areas: AreaDef[] = useMemo(() => {
    if (!packet || !sheet) return [];
    const out: AreaDef[] = [
      { key: "header", label: "Producer & Insured" },
      { key: "insurers", label: "Insurers" },
    ];
    for (const rs of sheet.sections) {
      if (rs.feeder) out.push({ key: rs.def.key, label: rs.def.name });
    }
    sheet.others.forEach((row, i) => {
      if (row.feeder) {
        out.push({ key: `other${i}`, label: row.label || "Additional Coverage" });
      }
    });
    // Holder confirms before Description: the description's holder wording
    // rebuilds when the holder changes, so the reverse order forces a
    // redundant re-confirm.
    out.push({ key: "holder", label: "Certificate Holder" });
    out.push({ key: "desc", label: "Description Of Operations" });
    return out;
  }, [packet, sheet]);

  const areaKeys = useMemo(() => new Set(areas.map((a) => a.key)), [areas]);
  const confirmedSet = useMemo(
    () => new Set(confirmedAreas.filter((k) => areaKeys.has(k))),
    [confirmedAreas, areaKeys],
  );
  const pendingCount = areas.filter((a) => !confirmedSet.has(a.key)).length;
  const allReviewed = packet != null && pendingCount === 0;
  const clean = verdict.rejects.length === 0;
  // Pre-bind accounts prepare everything; paper issues once payment lands.
  const preBind = account.status === "pre_bind";
  const canSign =
    allReviewed && clean && chosen.length > 0 && holderAddressOk && !preBind;
  const canPrint = canSign && signed;

  // Areas a reject currently points into — the guided card refuses to batch-
  // confirm the record step while any of its areas carries one, and
  // `confirmAreas` refuses independently below (fail-closed if the UI gate
  // ever drifts).
  const rejectAreas = useMemo(() => {
    const s = new Set<string>();
    for (const f of verdict.rejects) {
      const a = f.fieldId ? fieldArea(f.fieldId) : null;
      if (a) s.add(a);
    }
    return s;
  }, [verdict.rejects]);

  const areaCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of suggestions) {
      const a = fieldArea(s.id);
      if (a) m[a] = (m[a] ?? 0) + 1;
    }
    return m;
  }, [suggestions]);

  // ——— Area confirm state machine ———
  function reopenArea(key: string) {
    setSigned(false);
    setConfirmedAreas((prev) => prev.filter((k) => k !== key));
  }
  function confirmArea(key: string) {
    // The holder area cannot be approved over an unverified address.
    if (key === "holder" && !holderAddressOk) return;
    setConfirmedAreas((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setActiveArea((cur) => (cur === key ? null : cur));
  }
  // One attestation for the record-locked areas: the values are locked to
  // the schedule, verifier-checked, and shown with sources in the guided
  // card. Holder and Description never batch-confirm, and the whole batch
  // refuses while any requested area carries a verifier reject — same
  // contract the wizard's disabled button promises, enforced here too.
  function confirmAreas(keys: string[]) {
    if (keys.some((k) => rejectAreas.has(k))) return;
    const safe = keys.filter((k) => k !== "holder" && k !== "desc");
    if (safe.length === 0) return;
    setConfirmedAreas((prev) => [
      ...prev,
      ...safe.filter((k) => !prev.includes(k)),
    ]);
    setActiveArea(null);
  }
  // Any change to the sheet voids an applied signature; a change inside a
  // confirmed area re-opens just that area. Record fields refuse edits
  // while the coverage lock is on.
  function setOverride(id: string, v: string | boolean) {
    if (coverageLocked && isRecordField(id)) return;
    setSigned(false);
    const area = fieldArea(id);
    if (area) setConfirmedAreas((prev) => prev.filter((k) => k !== area));
    setOverrides((prev) => ({ ...prev, [id]: v }));
  }
  function unlockCoverage(ticketId: string) {
    setUnlockTicketId(ticketId);
  }
  // Relock drops every coverage edit — the sheet snaps back to the record —
  // and re-opens the affected review areas so nothing stale stays confirmed.
  function relockCoverage() {
    setUnlockTicketId(null);
    setSigned(false);
    setOverrides((prev) => {
      const next: SheetOverrides = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!isRecordField(k)) next[k] = v;
      }
      return next;
    });
    setConfirmedAreas((prev) =>
      prev.filter(
        (k) =>
          k !== "insurers" && !SECTION_AREA_KEYS.has(k) && !/^other\d+$/.test(k),
      ),
    );
  }
  function setHolderName(v: string) {
    setSigned(false);
    setHolderNameRaw(v);
    // The holder appears in the holder box AND the extracted description.
    setConfirmedAreas((prev) => prev.filter((k) => k !== "holder" && k !== "desc"));
  }
  function setHolderAddress(v: string) {
    setSigned(false);
    setHolderAddressRaw(v);
    setConfirmedAreas((prev) => prev.filter((k) => k !== "holder"));
  }
  // A different policy mix (or a different form) is a different sheet —
  // restart the review pass, and any run in flight is void. The guided
  // confirm card re-opens for the new sheet.
  function resetReview() {
    setOverrides({});
    setConfirmedAreas([]);
    setActiveArea(null);
    setSigned(false);
    setRun(null);
    setWizardOpen(true);
    setIssued(null);
    setCheckResults(null);
    setPreparedInfo(null);
  }
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    resetReview();
  }
  function selectAll() {
    if (selected.length === policies.length) return;
    setSelected(policies.map((p) => p.id));
    resetReview();
  }
  function switchForm(key: CertFormKey) {
    if (key === formKey) return;
    setFormKey(key);
    resetReview();
  }

  const ruleByPolicy = useMemo(
    () => new Map(placementRules.map((r) => [r.policyId, r])),
    [placementRules],
  );

  // ——— Holder rail: every holder this run could need, no retyping ———
  // Order of trust: ticket holders, then recorded AI/prior holders, then
  // desk-typed entries. Duplicates collapse to the most trusted source.
  const rail: RailEntry[] = useMemo(() => {
    const seen = new Set<string>();
    const out: RailEntry[] = [];
    const push = (e: RailEntry) => {
      const sig = `${e.name.trim().toLowerCase()}|${e.address.trim().toLowerCase()}`;
      if (!e.name.trim() || seen.has(sig)) return;
      seen.add(sig);
      out.push(e);
    };
    ticketHolders.forEach((h, i) =>
      push({
        key: `ticket-${i}`,
        name: h.name,
        address: h.address,
        source: "Ticket",
        requesterEmail: h.requesterEmail ?? null,
        detail: h.detail ?? null,
        savedId: null,
      }),
    );
    registryHolders.forEach((h, i) =>
      push({
        key: `registry-${i}`,
        name: h.name,
        address: h.address,
        source: "AI Registry",
        requesterEmail: null,
        detail: h.detail ?? null,
        savedId: null,
      }),
    );
    savedHolders.forEach((h) =>
      push({
        key: `saved-${h.id}`,
        name: h.name,
        address: h.address,
        source: "Desk",
        requesterEmail: null,
        detail: null,
        savedId: h.id,
      }),
    );
    return out;
  }, [ticketHolders, registryHolders, savedHolders]);

  // One click moves a rail holder into the holder box. The desc override is
  // dropped too: the description's holder wording must rebuild for THIS
  // holder — carrying an edited text over would smuggle the last holder's
  // name onto the new certificate.
  function loadHolder(h: { name: string; address: string }) {
    setSigned(false);
    setOverrides((prev) => {
      if (!("desc" in prev)) return prev;
      const next = { ...prev };
      delete next.desc;
      return next;
    });
    setHolderNameRaw(h.name);
    setHolderAddressRaw(h.address);
    setConfirmedAreas((prev) =>
      prev.filter((k) => k !== "holder" && k !== "desc"),
    );
  }

  const activeRailKey =
    rail.find(
      (e) =>
        e.name.trim() === holderName.trim() &&
        e.address.trim() === holderAddress.trim(),
    )?.key ?? null;

  // ——— The single send path, from the studio's side ———
  // Issuance always happens server-side: the exact inputs on screen go to
  // `issueCertificateAction`, which re-resolves against the schedule of
  // record, freezes the fact snapshot, and runs the canonical check
  // registry. The client only learns the outcome — there is no client-side
  // way to mark a certificate issued.
  function overrideRequests() {
    return Object.entries(checkOverrides)
      .filter(([, reason]) => reason.trim())
      .map(([checkId, reason]) => ({ checkId, reason: reason.trim() }));
  }
  function issueNow(path: "studio" | "run", onIssued?: (certId: string) => void) {
    if (!canSign || issuing) return;
    // The standard authorized-representative stamp applies with issuance —
    // it is the same deterministic mark every time, gated by the exact same
    // conditions, so a separate click adds nothing but a click.
    setSigned(true);
    const key = inputsKey;
    startIssuance(async () => {
      const outcome = await issueCertificateAction({
        accountId: account.id,
        policyIds: selected,
        formKey,
        holderName,
        holderAddress,
        overrides,
        checkOverrides: overrideRequests(),
        path,
      });
      setCheckResults(outcome.results);
      if (outcome.issued && outcome.certId) {
        setIssued({
          certId: outcome.certId,
          digest: outcome.snapshotDigest ?? "",
          key,
          issuedAt: outcome.issuedAt ?? "",
        });
        onIssued?.(outcome.certId);
      }
    });
  }
  // Pre-bind accounts prepare, never issue: the snapshot freezes now under a
  // TTL, and any upstream fact change invalidates it before send.
  function prepareNow() {
    if (issuing || !packet) return;
    startIssuance(async () => {
      const res = await prepareCertificateAction({
        accountId: account.id,
        policyIds: selected,
        formKey,
        holderName,
        holderAddress,
        overrides,
      });
      setPreparedInfo({ id: res.preparedId, expiresAt: res.expiresAt });
    });
  }
  const canPrepare =
    preBind &&
    packet != null &&
    allReviewed &&
    clean &&
    holderName.trim().length > 0 &&
    holderAddressOk;

  // ——— Batch run: shared areas confirmed once, then holder by holder ———
  function startRun() {
    if (rail.length === 0 || preBind || !packet) return;
    setRun({ queue: rail, idx: 0, done: [] });
    loadHolder(rail[0]);
  }
  // The current certificate is confirmed — it goes through the same
  // issuance function as a single certificate (signature applied with
  // issuance, no batch rail around the registry), and only an issued
  // outcome advances the run.
  function advanceRun() {
    if (!run || !canSign || !packet || !sheet || issuing) return;
    const description = effStr(overrides, "desc", certDescription(packet, sheet));
    const requesterEmail = run.queue[run.idx]?.requesterEmail ?? null;
    const snapshotHolderName = holderName;
    const snapshotHolderAddress = holderAddress;
    issueNow("run", (certId) => {
      const done: RunDoneCert = {
        holderName: snapshotHolderName,
        holderAddress: snapshotHolderAddress,
        description,
        requesterEmail,
        signedOn: new Date().toISOString().slice(0, 10),
        certId,
      };
      const nextIdx = run.idx + 1;
      setRun({ ...run, idx: nextIdx, done: [...run.done, done] });
      if (nextIdx < run.queue.length) loadHolder(run.queue[nextIdx]);
    });
  }

  // The blanket AI basis on the chosen schedule, if any — cited in the run
  // summary and the prepared emails. Same first-match rule as the packet's
  // description builder.
  const blanketBasis = useMemo(() => {
    for (const p of chosen) {
      const set = formSets[p.id];
      const ai = set ? findEndorsement(set, "ai") : undefined;
      if (ai) return `${ai.form} ${ai.edition}`.trim();
    }
    return null;
  }, [chosen, formSets]);

  const ctx: SheetCtx = {
    overrides,
    bad: new Set(
      verdict.rejects.map((f) => f.fieldId).filter((x): x is string => Boolean(x)),
    ),
    locked: (id) => coverageLocked && isRecordField(id),
    setOverride,
    activeArea,
    confirmed: confirmedSet,
    counts: areaCounts,
    isArea: (key) => areaKeys.has(key),
    begin: (key) => setActiveArea(key),
    confirm: confirmArea,
    reopen: reopenArea,
    cancel: () => setActiveArea(null),
  };

  const blockedReasons: string[] = [];
  if (preBind) blockedReasons.push("Pre-Bind — Payment Activates Issuance");
  if (pendingCount > 0)
    blockedReasons.push(`${pendingCount} Area${pendingCount === 1 ? "" : "s"} To Confirm`);
  if (verdict.rejects.length > 0)
    blockedReasons.push(`${verdict.rejects.length} Reject${verdict.rejects.length === 1 ? "" : "s"}`);
  if (!holderAddressOk)
    blockedReasons.push(
      holderCheck.phase !== "done"
        ? "Verifying Holder Address"
        : holderCheck.verdict?.status === "unavailable"
          ? "Holder Address Unverified — Validation Unavailable"
          : "Holder Address Unverified",
    );

  return (
    <section className="surface-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-4">
        <div>
          <p className="eyebrow">Certificate Studio</p>
          <h2 className="mt-0.5 font-display text-xl text-[var(--ink)]">
            {form.formNumber} — Confirm &amp; Issue
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--muted)]">
            The sheet fills from the schedule of record and stays locked to
            it. Confirm what the file says, set the holder, and issue — the
            verifier re-checks every change.
          </p>
          {preBind && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-600/25 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              Pre-Bind — Prepare Only. Build And Confirm Everything; Apply
              Signature And Print Unlock When Payment Is Received.
            </p>
          )}
          {hasGarage && (
            <div
              className="mt-2 inline-flex overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--paper)]"
              role="group"
              aria-label="Certificate Form"
            >
              {(Object.keys(CERT_FORMS) as CertFormKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchForm(key)}
                  className={`px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                    key === formKey
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                  title={CERT_FORMS[key].title}
                >
                  {CERT_FORMS[key].formNumber}
                </button>
              ))}
            </div>
          )}
        </div>
        {packet && (
          <div className="flex items-center gap-2">
            <StepPill
              n={1}
              label={allReviewed ? "Areas Confirmed" : `Confirm ${pendingCount} Area${pendingCount === 1 ? "" : "s"}`}
              done={allReviewed}
              active={!allReviewed}
            />
            <StepPill
              n={2}
              label={isIssuedRender ? "Signed & Issued" : "Sign & Issue"}
              done={isIssuedRender}
              active={canSign && !isIssuedRender}
            />
            {preBind ? (
              <button
                type="button"
                onClick={prepareNow}
                disabled={!canPrepare || issuing}
                className="btn-primary disabled:opacity-45"
                title={
                  canPrepare
                    ? "Freeze the fact snapshot under a TTL — issuance waits for payment"
                    : `Blocked — ${blockedReasons.join(", ")}`
                }
              >
                {issuing
                  ? "Preparing…"
                  : preparedInfo
                    ? "Prepared ✓ — Re-Prepare"
                    : "Prepare Certificate"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => issueNow("studio")}
                disabled={!canSign || issuing || isIssuedRender}
                className="btn-primary disabled:opacity-45"
                title={
                  isIssuedRender
                    ? "This exact certificate is on the ledger"
                    : canSign
                      ? "Apply the standard signature, run the presend registry, and record the certificate on the ledger"
                      : `Blocked — ${blockedReasons.join(", ")}`
                }
              >
                {issuing
                  ? "Running Presend Checks…"
                  : isIssuedRender
                    ? "Issued & On The Ledger"
                    : canSign
                      ? "Sign & Issue Certificate"
                      : `Blocked — ${blockedReasons.join(" · ")}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-ghost"
              title={
                specimen
                  ? "Prints with the Specimen — Not Issued watermark; only an issued render prints clean"
                  : "Print or save the issued certificate as PDF"
              }
            >
              {specimen ? "Print Specimen" : "Print / Save PDF"}
            </button>
          </div>
        )}
      </header>

      <div className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          {run && (
            <RunPanel
              run={run}
              accountName={account.name}
              formNumber={form.formNumber}
              canAdvance={canSign && !issuing}
              canPrint={canPrint}
              blockedReasons={blockedReasons}
              blanketBasis={blanketBasis}
              policyNumbers={chosen.map((p) => p.policyNumber)}
              carriers={Array.from(new Set(chosen.map((p) => p.carrier)))}
              onAdvance={advanceRun}
              onPrint={() => window.print()}
              onLoadDone={(c) =>
                loadHolder({ name: c.holderName, address: c.holderAddress })
              }
              onCancel={() => setRun(null)}
            />
          )}

          {(checkResults || isIssuedRender || preparedInfo) && (
            <div className="rounded-xl border border-[var(--rule)] bg-white p-3">
              <p className="eyebrow">Presend Checks — Canonical Registry</p>
              {isIssuedRender && issued && (
                <p className="mt-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800">
                  Issued & On The Ledger — {issued.certId} · Snapshot{" "}
                  <span className="font-mono">{issued.digest.slice(0, 12)}</span>
                </p>
              )}
              {preparedInfo && (
                <p className="mt-1.5 rounded-lg border border-amber-600/25 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                  Prepared — Snapshot Frozen, TTL To{" "}
                  {preparedInfo.expiresAt.slice(0, 16).replace("T", " ")}. Any
                  Upstream Fact Change Invalidates It.
                </p>
              )}
              {checkResults && (
                <div className="mt-2">
                  <CertChecksPanel
                    results={checkResults}
                    overrides={checkOverrides}
                    onOverrideChange={(id, reason) =>
                      setCheckOverrides((m) => ({ ...m, [id]: reason }))
                    }
                    disabled={issuing}
                  />
                </div>
              )}
            </div>
          )}

          <NextInsuranceAdvisory carriers={chosen.map((p) => p.carrier)} />

          <CoverageLockPanel
            tickets={endorsementTickets}
            unlockTicket={unlockTicket}
            onUnlock={unlockCoverage}
            onRelock={relockCoverage}
          />

          <PolicyPicker
            policies={policies}
            selected={selected}
            onToggle={toggle}
            onAll={selectAll}
            insurers={packet?.insurers ?? []}
            sheet={sheet}
          />

          <HolderRail
            accountId={account.id}
            rail={rail}
            activeKey={activeRailKey}
            onLoad={loadHolder}
            onRunAll={startRun}
            runActive={run != null && run.idx < run.queue.length}
            preBind={preBind}
            hasPacket={packet != null}
          />

          <label className="block">
            <span className="eyebrow">Certificate Holder</span>
            <input
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Exactly as the contract spells it"
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between gap-2">
              <span className="eyebrow">Holder Address</span>
              <AddressStatusChip
                check={holderCheck}
                onApplyStandardized={setHolderAddress}
              />
            </span>
            <input
              value={holderAddress}
              onChange={(e) => setHolderAddress(e.target.value)}
              placeholder="Street, City, ST ZIP"
              className={`field mt-1 ${holderAddressOk ? "" : "field-bad"}`}
            />
          </label>

          {packet && areas.length > 0 && (
            <ReviewProgress
              areas={areas}
              confirmed={confirmedSet}
              activeArea={activeArea}
              onOpenWizard={
                !wizardOpen && !allReviewed
                  ? () => setWizardOpen(true)
                  : undefined
              }
            />
          )}

          {placementRules.length > 0 && (
            <DeskCorrections
              accountId={account.id}
              rules={placementRules}
              policies={policies}
              form={form}
            />
          )}

          {packet && verdict.findings.length > 0 && (
            <ChecksPanel findings={verdict.findings} guidance={guidance} />
          )}

          <PriceSignals
            guidance={guidance}
            carriers={Array.from(new Set(chosen.map((p) => p.carrier)))}
          />
        </div>

        <div className="min-w-0">
          {packet && sheet && (
            <div className="no-print mb-2 flex items-center justify-end gap-1">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Sheet Zoom
              </span>
              {[1, 1.25, 1.5].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  aria-pressed={zoom === z}
                  className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition ${
                    zoom === z
                      ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                      : "border-[var(--rule)] bg-white text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            {packet && sheet ? (
              <div className="sheet-zoom" style={{ zoom }}>
                <AcordSheet
                  packet={packet}
                  sheet={sheet}
                  form={form}
                  ctx={ctx}
                  specimen={specimen}
                  accountId={account.id}
                  ruleByPolicy={ruleByPolicy}
                  holderName={holderName}
                  setHolderName={setHolderName}
                  holderAddress={holderAddress}
                  setHolderAddress={setHolderAddress}
                  holderCheck={holderCheck}
                  holderAddressOk={holderAddressOk}
                  signed={signed}
                  canSign={canSign}
                  onSign={() => setSigned(true)}
                  onClearSign={() => setSigned(false)}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center rounded-2xl border border-dashed border-[var(--rule)] text-sm text-[var(--muted)]">
                Turn on at least one policy to draft the certificate.
              </div>
            )}
          </div>
        </div>
      </div>

      {packet && wizardOpen && !allReviewed && (
        <ConfirmWizard
          areas={areas}
          confirmed={confirmedSet}
          activeArea={activeArea}
          suggestions={suggestions}
          rejectAreas={rejectAreas}
          holderName={holderName}
          holderAddress={holderAddress}
          holderAddressOk={holderAddressOk}
          rail={rail}
          activeRailKey={activeRailKey}
          onLoadHolder={loadHolder}
          onBegin={(key) => setActiveArea(key)}
          onConfirm={confirmArea}
          onConfirmMany={confirmAreas}
          onClose={() => {
            setWizardOpen(false);
            setActiveArea(null);
          }}
        />
      )}
    </section>
  );
}

function StepPill({
  n,
  label,
  done,
  active,
}: {
  n: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        done
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : active
            ? "border-[var(--gold)] bg-white text-[var(--ink)]"
            : "border-[var(--rule)] bg-[var(--paper)] text-[var(--muted)]"
      }`}
    >
      <span className="font-mono">{done ? "✓" : n}</span> {label}
    </span>
  );
}

/* ————————————————————————— Policy picker ————————————————————————— */

/** Compact coverage-type chip labels for the picker. */
const COVERAGE_CHIP: Record<string, string> = {
  GL: "GL",
  WC: "WC",
  CA: "Auto",
  COMM: "Auto",
  EXCESS_UMB: "Umbrella",
  Umb: "Umbrella",
  TECH_EO: "E&O",
  PL: "E&O",
  CL: "Cyber",
  BOP: "BOP",
  Prop: "Property",
  Garage: "Garage",
  GK: "Garagekeepers",
  HNOA: "HNOA",
  Liquor: "Liquor",
  ProdL: "Products",
};

function coverageChip(code: string): string {
  return COVERAGE_CHIP[code] ?? code;
}

/** Short names for the "will fill" summary. */
const SECTION_SHORT: Record<string, string> = {
  gl: "GL",
  auto: "Auto",
  umbrella: "Umbrella",
  wc: "WC",
  garageLiability: "Garage Liability",
  garageKeepers: "Garage Keepers",
};

/**
 * What goes on the cert — policies grouped by carrier with the vendored
 * brand mark and the insurer letter they'll print under, one-tap coverage
 * toggles, an All Policies quick action, and a live summary of which ACORD
 * sections the current mix will fill.
 */
function PolicyPicker({
  policies,
  selected,
  onToggle,
  onAll,
  insurers,
  sheet,
}: {
  policies: Policy[];
  selected: string[];
  onToggle: (id: string) => void;
  onAll: () => void;
  insurers: CertInsurer[];
  sheet: Acord25Sheet | null;
}) {
  const carriers: string[] = [];
  for (const p of policies) {
    if (!carriers.includes(p.carrier)) carriers.push(p.carrier);
  }
  const allOn = selected.length === policies.length;

  const willFill: string[] = [];
  if (sheet) {
    for (const rs of sheet.sections) {
      if (rs.feeder) willFill.push(SECTION_SHORT[rs.def.key] ?? rs.def.name);
    }
    for (const row of sheet.others) {
      if (row.feeder && row.label) willFill.push(row.label);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="eyebrow">Policies On The Certificate</p>
        <button
          type="button"
          onClick={onAll}
          disabled={allOn}
          className="rounded-full border border-[var(--rule)] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:border-[var(--gold)] disabled:opacity-40"
        >
          All Policies
        </button>
      </div>
      <div className="space-y-2">
        {carriers.map((carrier) => {
          const group = policies.filter((p) => p.carrier === carrier);
          const letter = insurers.find((i) => i.carrier === carrier)?.letter;
          return (
            <div
              key={carrier}
              className="rounded-xl border border-[var(--rule)] bg-white p-2"
            >
              <div className="flex items-center gap-2">
                <CarrierLogo name={carrier} size={26} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--ink)]">
                  {carrier}
                </span>
                {letter && (
                  <span
                    className="shrink-0 rounded border border-[var(--rule)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ink)]"
                    title={`Prints as Insurer ${letter}`}
                  >
                    Insurer {letter}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {group.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onToggle(p.id)}
                      aria-pressed={on}
                      title={`${p.policyNumber} · ${p.coverages
                        .map(coverageLabel)
                        .join(", ")}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition ${
                        on
                          ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--ink)]"
                          : "border-[var(--rule)] bg-[var(--paper)] text-[var(--muted)] opacity-70"
                      }`}
                    >
                      <span className="font-mono text-[9px]">{on ? "✓" : "○"}</span>
                      {p.coverages.map(coverageChip).join(" + ")}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 rounded-lg border border-dashed border-[var(--rule)] bg-[var(--paper)] px-2 py-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Sections That Will Fill
        </p>
        {willFill.length === 0 ? (
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            Nothing yet — turn on at least one policy.
          </p>
        ) : (
          <p className="mt-0.5 flex flex-wrap gap-1">
            {willFill.map((name) => (
              <span
                key={name}
                className="rounded bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--ink)] ring-1 ring-[var(--rule)]"
              >
                {name}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/* ————————————————————————— Area review affordances ————————————————————————— */

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[7.5px] font-semibold uppercase tracking-wide leading-none";

/**
 * The slim review strip attached to each ACORD area. Pending → "Review"
 * (highlights the area's extracted values); active → "Confirm Section";
 * confirmed → a subtle check that re-opens on click. Never prints.
 */
function AreaChip({
  area,
  ctx,
  className,
}: {
  area: string;
  ctx: SheetCtx;
  className?: string;
}) {
  if (!ctx.isArea(area)) return null;
  const state: AreaState = ctx.confirmed.has(area)
    ? "confirmed"
    : ctx.activeArea === area
      ? "active"
      : "pending";

  if (state === "confirmed") {
    return (
      <button
        type="button"
        onClick={() => ctx.reopen(area)}
        title="Confirmed — click to reopen this area"
        className={`no-print ${CHIP_BASE} border-emerald-300 bg-emerald-50 text-emerald-800 ${className ?? ""}`}
        data-area-state="confirmed"
      >
        ✓ Confirmed
      </button>
    );
  }
  if (state === "active") {
    return (
      <span className={`no-print inline-flex items-center gap-1 ${className ?? ""}`}>
        <button
          type="button"
          onClick={() => ctx.confirm(area)}
          title="Approve every highlighted value in this area"
          className={`${CHIP_BASE} border-emerald-600 bg-emerald-600 text-white`}
          data-area-state="active"
        >
          Confirm Section
        </button>
        <button
          type="button"
          onClick={ctx.cancel}
          title="Keep it pending"
          className={`${CHIP_BASE} border-[var(--rule)] bg-white text-[var(--muted)]`}
        >
          ✕
        </button>
      </span>
    );
  }
  const n = ctx.counts[area] ?? 0;
  return (
    <button
      type="button"
      onClick={() => ctx.begin(area)}
      title="Highlight this area's extracted values for review"
      className={`no-print ${CHIP_BASE} border-amber-400 bg-amber-50 text-amber-900 ${className ?? ""}`}
      data-area-state="pending"
    >
      Review{n > 0 ? ` ${n}` : ""}
    </button>
  );
}

/** Rail-side progress: which areas are done, which one is lit. */
function ReviewProgress({
  areas,
  confirmed,
  activeArea,
  onOpenWizard,
}: {
  areas: AreaDef[];
  confirmed: Set<string>;
  activeArea: string | null;
  onOpenWizard?: () => void;
}) {
  const done = areas.filter((a) => confirmed.has(a.key)).length;
  return (
    <div className="rounded-xl border border-[var(--gold)]/50 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Area Review</p>
        {onOpenWizard && (
          <button
            type="button"
            onClick={onOpenWizard}
            className="rounded-full border border-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:bg-[var(--gold)]/20"
          >
            Guided Confirm
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
        Review happens on the sheet — each area has its own strip. Confirm all{" "}
        {areas.length} areas to unlock Sign &amp; Issue.
      </p>
      <p className="mt-2 text-[11px] font-semibold text-[var(--ink)]">
        {done} Of {areas.length} Areas Confirmed
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {areas.map((a) => (
          <li
            key={a.key}
            className={`flex items-center gap-1.5 text-[11px] ${
              confirmed.has(a.key)
                ? "text-emerald-700"
                : a.key === activeArea
                  ? "text-amber-700"
                  : "text-[var(--muted)]"
            }`}
          >
            <span className="font-mono text-[9px]">
              {confirmed.has(a.key) ? "✓" : a.key === activeArea ? "●" : "○"}
            </span>
            {a.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One extracted value inside the guided card — display + source cite. */
function WizardValueRow({ s }: { s: FieldSuggestion }) {
  return (
    <li className="flex items-baseline justify-between gap-2 rounded-lg border border-[var(--rule)] bg-white px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {s.label}
      </span>
      <span className="min-w-0 text-right">
        <span className="block truncate text-[11px] font-semibold text-[var(--ink)]">
          {s.display}
        </span>
        <span className="block text-[9px] uppercase tracking-wide text-[var(--muted)]">
          {s.source}
        </span>
      </span>
    </li>
  );
}

/**
 * The guided confirm card. Opens on its own as soon as the sheet fills.
 * Step one batches every record-locked area — the values are locked to the
 * schedule and verifier-checked, so a single read-through and one click
 * attests them all (refused while any of those areas carries a reject).
 * The two per-certificate decisions, Certificate Holder and Description,
 * then confirm one at a time; the holder step carries the rail so a ticket
 * holder loads without leaving the card. Closing it never blocks anything:
 * the on-sheet review strips are the same state machine.
 */
function ConfirmWizard({
  areas,
  confirmed,
  activeArea,
  suggestions,
  rejectAreas,
  holderName,
  holderAddress,
  holderAddressOk,
  rail,
  activeRailKey,
  onLoadHolder,
  onBegin,
  onConfirm,
  onConfirmMany,
  onClose,
}: {
  areas: AreaDef[];
  confirmed: Set<string>;
  activeArea: string | null;
  suggestions: FieldSuggestion[];
  rejectAreas: Set<string>;
  holderName: string;
  holderAddress: string;
  holderAddressOk: boolean;
  rail: RailEntry[];
  activeRailKey: string | null;
  onLoadHolder: (h: { name: string; address: string }) => void;
  onBegin: (key: string) => void;
  onConfirm: (key: string) => void;
  onConfirmMany: (keys: string[]) => void;
  onClose: () => void;
}) {
  const isPerCert = (key: string) => key === "holder" || key === "desc";
  const recordPending = areas.filter(
    (a) => !isPerCert(a.key) && !confirmed.has(a.key),
  );
  const perCertPending = areas.filter(
    (a) => isPerCert(a.key) && !confirmed.has(a.key),
  );
  const done = areas.length - recordPending.length - perCertPending.length;
  const onRecordStep = recordPending.length > 0;
  const current = onRecordStep
    ? null
    : (perCertPending.find((a) => a.key === activeArea) ??
      perCertPending[0] ??
      null);

  // Light the area under review on the sheet — the record step lights
  // nothing (it spans areas); the per-certificate steps light their area.
  const currentKey = current?.key ?? null;
  useEffect(() => {
    if (currentKey && activeArea !== currentKey) onBegin(currentKey);
    // Re-light only when the card's target area changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  if (!onRecordStep && !current) return null;

  const frame = (title: string, body: React.ReactNode, foot: React.ReactNode) => (
    <div className="no-print fixed bottom-5 left-1/2 z-40 w-[min(100vw-2rem,430px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--gold)]/60 bg-[var(--paper)] shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--rule)] bg-white px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          {title} · {done} Of {areas.length} Areas Done
        </p>
        <button
          type="button"
          onClick={onClose}
          title="Close — the on-sheet review strips stay available"
          className="rounded px-1 text-sm leading-none text-[var(--muted)] hover:text-[var(--ink)]"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[44vh] overflow-y-auto px-3 py-2.5">{body}</div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--rule)] bg-white px-3 py-2">
        {foot}
      </div>
    </div>
  );

  // ——— Step one: everything the file says, one attestation ———
  if (onRecordStep) {
    const blocked = recordPending.filter((a) => rejectAreas.has(a.key));
    return frame(
      "Confirm From The File",
      <>
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          These values are locked to the schedule of record and already
          verifier-checked — read them once and confirm them together.
        </p>
        {recordPending.map((a) => {
          const values = suggestions.filter((s) => fieldArea(s.id) === a.key);
          return (
            <div key={a.key} className="mt-2">
              <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--ink)]">
                {a.label}
                {rejectAreas.has(a.key) && (
                  <span className="rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-red-800">
                    Carries A Reject
                  </span>
                )}
              </p>
              {values.length === 0 ? (
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  Nothing extracted — the area prints blank.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {values.map((s) => (
                    <WizardValueRow key={s.id} s={s} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {blocked.length > 0 && (
          <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[10.5px] text-red-800">
            {blocked.length} area{blocked.length === 1 ? "" : "s"} carr
            {blocked.length === 1 ? "ies" : "y"} a reject — resolve it in the
            Checks panel before confirming.
          </p>
        )}
      </>,
      <>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          Review On The Sheet
        </button>
        <button
          type="button"
          onClick={() => onConfirmMany(recordPending.map((a) => a.key))}
          disabled={blocked.length > 0}
          className="rounded-lg bg-emerald-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:bg-emerald-700 disabled:opacity-45"
        >
          Confirm All ({recordPending.length} Area
          {recordPending.length === 1 ? "" : "s"})
        </button>
      </>,
    );
  }

  // ——— Per-certificate steps: Certificate Holder, then Description ———
  if (!current) return null;
  const values = suggestions.filter((s) => fieldArea(s.id) === current.key);
  const holderStep = current.key === "holder";
  const holderBlocked =
    holderStep && (!holderAddressOk || !holderName.trim());

  function advance(afterKey: string, alsoConfirm: boolean) {
    if (alsoConfirm) onConfirm(afterKey);
    const next = perCertPending.find(
      (a) => a.key !== afterKey && !confirmed.has(a.key),
    );
    if (next) onBegin(next.key);
  }

  return frame(
    current.label,
    <>
      {holderStep ? (
        <>
          {holderName.trim() ? (
            <div className="rounded-lg border border-[var(--rule)] bg-white px-2 py-1.5">
              <p className="text-[11.5px] font-semibold text-[var(--ink)]">
                {holderName}
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                {holderAddress.trim() || "No address given"}
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              No holder yet — load one from the rail below, or type it on the
              sheet exactly as the contract spells it.
            </p>
          )}
          {rail.length > 0 && (
            <div className="mt-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                On The Rail
              </p>
              <ul className="mt-1 space-y-1">
                {rail.map((e) => (
                  <li
                    key={e.key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--rule)] bg-white px-2 py-1"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-[var(--ink)]">
                        {e.name}
                      </span>
                      <span className="block truncate text-[9.5px] text-[var(--muted)]">
                        {e.source}
                        {e.address ? ` · ${e.address}` : ""}
                      </span>
                    </span>
                    {e.key === activeRailKey ? (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                        ✓ On The Sheet
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onLoadHolder({ name: e.name, address: e.address })
                        }
                        className="shrink-0 rounded-lg border border-[var(--gold)] bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ink)] hover:bg-[var(--gold)]/10"
                      >
                        Use
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {holderName.trim() && !holderAddressOk && (
            <p className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[10.5px] text-red-800">
              The holder address must verify before this area can be
              confirmed.
            </p>
          )}
        </>
      ) : values.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          Nothing extracted for this area — review it on the sheet, fill what
          the certificate needs, then confirm.
        </p>
      ) : (
        <ul className="space-y-1">
          {values.map((s) => (
            <WizardValueRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </>,
    <>
      <button
        type="button"
        onClick={() => advance(current.key, false)}
        className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        Skip For Now
      </button>
      <button
        type="button"
        onClick={() => advance(current.key, true)}
        disabled={holderBlocked}
        title={
          holderBlocked
            ? !holderName.trim()
              ? "A certificate has to name who it's issued to"
              : "The holder address must verify first"
            : undefined
        }
        className="rounded-lg bg-emerald-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:bg-emerald-700 disabled:opacity-45"
      >
        Confirm &amp; Next
      </button>
    </>,
  );
}

/* ————————————————————————— Holder rail ————————————————————————— */

const RAIL_SOURCE_STYLES: Record<RailEntry["source"], string> = {
  Ticket: "border-sky-300 bg-sky-50 text-sky-800",
  "AI Registry": "border-violet-300 bg-violet-50 text-violet-800",
  Desk: "border-stone-300 bg-stone-50 text-stone-700",
};

/**
 * The holder rail: every certificate holder this ask could need, visible and
 * one click from the sheet. Sources in order of trust — ticket holders, the
 * account's recorded additional insureds / prior holders, then desk-typed
 * entries (persisted, editable, removable). Nothing on the rail is invented.
 */
function HolderRail({
  accountId,
  rail,
  activeKey,
  onLoad,
  onRunAll,
  runActive,
  preBind,
  hasPacket,
}: {
  accountId: string;
  rail: RailEntry[];
  activeKey: string | null;
  onLoad: (h: { name: string; address: string }) => void;
  onRunAll: () => void;
  runActive: boolean;
  preBind: boolean;
  hasPacket: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const runBlocked = !hasPacket
    ? "Turn on at least one policy first"
    : preBind
      ? "Pre-Bind — Payment Activates Issuance"
      : runActive
        ? "A run is already in progress"
        : rail.length === 0
          ? "The rail is empty"
          : null;

  return (
    <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">
          Certificate Holders{rail.length > 0 ? ` · ${rail.length}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2 hover:text-[var(--ink)]"
        >
          {adding ? "Close" : "Add Holder"}
        </button>
      </div>

      {rail.length === 0 && !adding && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          No holders on the rail yet. Ticket holders and recorded additional
          insureds land here automatically; Add Holder types one in.
        </p>
      )}

      {adding && (
        <form
          action={addCertHolderAction}
          className="mt-2 space-y-1.5 rounded-lg border border-dashed border-[var(--rule)] p-2"
        >
          <input type="hidden" name="accountId" value={accountId} />
          <input
            name="name"
            required
            placeholder="Holder name — exactly as the contract spells it"
            className="field text-xs"
          />
          <input
            name="address"
            placeholder="Street, City, ST ZIP (optional)"
            className="field text-xs"
          />
          <button type="submit" className="btn-ghost w-full text-[11px]">
            Save To Rail
          </button>
        </form>
      )}

      {rail.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rail.map((e) => (
            <RailRow
              key={e.key}
              entry={e}
              accountId={accountId}
              active={e.key === activeKey}
              onLoad={onLoad}
            />
          ))}
        </ul>
      )}

      {rail.length > 0 && (
        <button
          type="button"
          onClick={onRunAll}
          disabled={runBlocked != null}
          title={runBlocked ?? `Produce ${rail.length} certificates, one per holder`}
          className="btn-primary mt-2.5 w-full text-[11px] disabled:opacity-45"
        >
          Run All Holders ({rail.length})
        </button>
      )}
      {runBlocked === "Pre-Bind — Payment Activates Issuance" && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-amber-800">
          Pre-Bind — Payment Activates Issuance. The rail stays editable; the
          run unlocks with payment.
        </p>
      )}
    </div>
  );
}

/** One rail entry: load in one click; desk entries edit in place. */
function RailRow({
  entry,
  accountId,
  active,
  onLoad,
}: {
  entry: RailEntry;
  accountId: string;
  active: boolean;
  onLoad: (h: { name: string; address: string }) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && entry.savedId) {
    return (
      <li className="rounded-lg border border-[var(--gold)] bg-white p-2">
        <form action={updateCertHolderAction} className="space-y-1.5">
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="holderId" value={entry.savedId} />
          <input
            name="name"
            defaultValue={entry.name}
            required
            className="field text-xs"
          />
          <input
            name="address"
            defaultValue={entry.address}
            className="field text-xs"
          />
          <div className="flex gap-1.5">
            <button
              type="submit"
              onClick={() => setEditing(false)}
              className="btn-ghost flex-1 text-[10px]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg border border-[var(--rule)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={`rounded-lg border p-2 ${
        active
          ? "border-emerald-400 bg-emerald-50/60"
          : "border-[var(--rule)] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-[var(--ink)]" title={entry.name}>
            {entry.name}
          </p>
          <p className="truncate text-[10.5px] text-[var(--muted)]" title={entry.address}>
            {entry.address || "No address given"}
          </p>
          {entry.detail && (
            <p className="mt-0.5 truncate text-[9.5px] text-[var(--muted)]" title={entry.detail}>
              {entry.detail}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide ${RAIL_SOURCE_STYLES[entry.source]}`}
        >
          {entry.source}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {active ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800">
            ✓ On The Sheet
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onLoad({ name: entry.name, address: entry.address })}
            className="rounded-lg border border-[var(--gold)] bg-white px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:bg-[var(--gold)]/10"
          >
            Load Into Certificate
          </button>
        )}
        {entry.savedId && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2 hover:text-[var(--ink)]"
            >
              Edit
            </button>
            <form action={removeCertHolderAction} className="inline">
              <input type="hidden" name="accountId" value={accountId} />
              <input type="hidden" name="holderId" value={entry.savedId} />
              <button
                type="submit"
                className="text-[9.5px] font-semibold uppercase tracking-wide text-rose-700 underline decoration-rose-200 underline-offset-2"
              >
                Remove
              </button>
            </form>
          </>
        )}
      </div>
    </li>
  );
}

/* ————————————————————————— Certificate run ————————————————————————— */

/**
 * The batch run stepper. Shared areas were confirmed once on the live sheet;
 * this panel walks holder by holder — each holder's block (and its
 * holder-specific description wording) is confirmed and signed through the
 * existing gates before the certificate joins the run. When the last holder
 * lands, the panel becomes the run summary with prepared emails.
 */
function RunPanel({
  run,
  accountName,
  formNumber,
  canAdvance,
  canPrint,
  blockedReasons,
  blanketBasis,
  policyNumbers,
  carriers,
  onAdvance,
  onPrint,
  onLoadDone,
  onCancel,
}: {
  run: RunState;
  accountName: string;
  formNumber: string;
  canAdvance: boolean;
  canPrint: boolean;
  blockedReasons: string[];
  blanketBasis: string | null;
  policyNumbers: string[];
  carriers: string[];
  onAdvance: () => void;
  onPrint: () => void;
  onLoadDone: (c: RunDoneCert) => void;
  onCancel: () => void;
}) {
  const total = run.queue.length;
  const complete = run.idx >= total;
  const current = complete ? null : run.queue[run.idx];

  if (!complete && current) {
    return (
      <div className="rounded-xl border border-[var(--gold)] bg-[var(--gold)]/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Certificate Run</p>
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2 hover:text-[var(--ink)]"
          >
            Cancel Run
          </button>
        </div>
        <p className="mt-1 text-[13px] font-semibold text-[var(--ink)]">
          Holder {run.idx + 1} Of {total} — {current.name}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          This holder is on the sheet. Confirm the Certificate Holder and
          Description areas — Issue applies the signature, runs the presend
          registry, and records the certificate on the ledger before the next
          holder swaps in. Shared areas stay confirmed.
        </p>
        {run.done.length > 0 && (
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            {run.done.length} Of {total} In The Run
          </p>
        )}
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onPrint}
            disabled={!canPrint}
            title={canPrint ? "Print or save as PDF" : `Blocked — ${blockedReasons.join(", ")}`}
            className="btn-ghost w-full text-[11px] disabled:opacity-45"
          >
            Print This Certificate
          </button>
          <button
            type="button"
            onClick={onAdvance}
            disabled={!canAdvance}
            title={
              canAdvance
                ? "Run the presend registry, record the certificate on the ledger, then advance"
                : `Blocked — ${blockedReasons.join(", ")}`
            }
            className="btn-primary w-full text-[11px] disabled:opacity-45"
          >
            {run.idx + 1 < total
              ? "Issue & Next Holder"
              : "Issue & Finish Run"}
          </button>
        </div>
      </div>
    );
  }

  // ——— Run complete: summary + prepared emails ———
  const runResult: CertificateRun = {
    blocked: false,
    blockedReason: null,
    certificates: run.done.map(
      (d): RunCertificate => ({
        holderName: d.holderName,
        holderAddress: d.holderAddress,
        description: d.description,
        policyNumbers,
        carriers,
        blanketBasis,
        okToIssue: true,
        rejectIds: [],
        requesterEmail: d.requesterEmail,
      }),
    ),
  };
  const emails = prepareRunEmails(runResult, { accountName, formNumber });

  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Certificate Run — Complete</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2 hover:text-[var(--ink)]"
        >
          Close Run
        </button>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-[var(--ink)]">
        {run.done.length} Certificate{run.done.length === 1 ? "" : "s"} Issued
        {blanketBasis ? ` — Blanket Basis ${blanketBasis}` : ""}
      </p>
      <ul className="mt-2 space-y-1.5">
        {run.done.map((c, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--rule)] bg-white px-2 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-semibold text-[var(--ink)]">
                {c.holderName}
              </p>
              <p className="text-[9.5px] text-[var(--muted)]">
                Issued {mdy(c.signedOn)} · <span className="font-mono">{c.certId}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLoadDone(c)}
              title="Put this holder back on the sheet — re-confirm the holder area to reprint"
              className="shrink-0 rounded-lg border border-[var(--rule)] bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ink)] hover:border-[var(--gold)]"
            >
              Load For Reprint
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-[var(--rule)] pt-2">
        <p className="eyebrow">Email The Certificates</p>
        <p className="mt-1 inline-flex rounded-full border border-amber-600/25 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
          Prepared For Send — Mail Hookup Lands With The Live Inbox
        </p>
        <ul className="mt-2 space-y-1.5">
          {emails.map((m, i) => (
            <PreparedEmailRow key={i} email={m} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One prepared outbound email — reviewable, copyable, never "sent". */
function PreparedEmailRow({
  email,
}: {
  email: { to: string | null; subject: string; body: string; holderName: string };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `To: ${email.to ?? ""}\nSubject: ${email.subject}\n\n${email.body}`;
  return (
    <li className="rounded-lg border border-[var(--rule)] bg-white p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[var(--ink)]" title={email.subject}>
            {email.subject}
          </p>
          <p className="truncate text-[10px] text-[var(--muted)]">
            {email.to ? `To ${email.to}` : "Requester Email Not On File"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2 hover:text-[var(--ink)]"
          >
            {open ? "Hide" : "Preview"}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg border border-[var(--gold)] bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ink)] hover:bg-[var(--gold)]/10"
          >
            {copied ? "Copied ✓" : "Copy Email"}
          </button>
        </div>
      </div>
      {open && (
        <pre className="mt-1.5 whitespace-pre-wrap rounded border border-[var(--rule)] bg-[var(--paper)] p-2 text-[10px] leading-relaxed text-[var(--ink)]">
          {text}
        </pre>
      )}
    </li>
  );
}

/* ————————————————————————— Carrier advisory ————————————————————————— */

/**
 * NEXT issues instant certificates from its own portal — worth a prominent,
 * non-blocking pointer whenever a selected policy rides NEXT paper. The
 * portal URL comes off the carrier record on file; nothing is invented.
 */
function NextInsuranceAdvisory({ carriers }: { carriers: string[] }) {
  if (!carriers.includes("NEXT Insurance")) return null;
  const intel = CARRIER_INTEL.find((c) => c.name === "NEXT Insurance");
  const portal = intel?.portal ?? null;
  return (
    <div className="rounded-xl border border-[var(--harper-orange,#e8672b)]/40 bg-[var(--gold)]/10 p-3">
      <p className="eyebrow">Carrier Advisory</p>
      <p className="mt-0.5 text-[12px] font-semibold text-[var(--ink)]">
        Next Issues Instant Certificates — Fastest Path Is The Next Portal
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        This account rides NEXT Insurance paper. The desk can still issue from
        the schedule of record below — but for a standard holder cert, the NEXT
        portal issues instantly.
      </p>
      <p className="mt-2 flex flex-wrap gap-2">
        {portal && (
          <a
            href={portal}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--rule)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:border-[var(--gold)]"
          >
            Open NEXT Portal ↗
          </a>
        )}
      </p>
    </div>
  );
}

/**
 * The coverage lock. Coverage rows, limits, and insurer identity print from
 * the schedule of record and stay read-only. Editing unlocks only against an
 * open endorsement or exposure-change ticket on this account — the unlock is
 * cited on the panel while it is active, and relocking snaps every coverage
 * cell back to the record.
 */
function CoverageLockPanel({
  tickets,
  unlockTicket,
  onUnlock,
  onRelock,
}: {
  tickets: EndorsementTicketView[];
  unlockTicket: EndorsementTicketView | null;
  onUnlock: (ticketId: string) => void;
  onRelock: () => void;
}) {
  if (unlockTicket) {
    return (
      <div className="rounded-xl border border-amber-600/30 bg-amber-50 p-3">
        <p className="eyebrow">Coverage Data — Editing Unlocked</p>
        <p className="mt-0.5 text-[12px] font-semibold text-[var(--ink)]">
          {unlockTicket.label} · {unlockTicket.status}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          Coverage cells are editable while this endorsement is in flight.
          Every edit still runs the verifier; anything the paper cannot back
          is rejected. Relock discards coverage edits and returns the sheet to
          the schedule of record.
        </p>
        <button
          type="button"
          onClick={onRelock}
          className="mt-2 rounded-lg border border-[var(--rule)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:border-[var(--gold)]"
        >
          Relock To Record
        </button>
      </div>
    );
  }
  // The common case — no endorsement in flight — collapses to one line;
  // the lock itself never loosens, so there is nothing to act on here.
  if (tickets.length === 0) {
    return (
      <details className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Coverage Data — Locked To The Record
        </summary>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          Coverage rows, limits, and insurer identity print from the schedule
          of record and are not editable. Holder, description, and the
          Additional Insured / Waiver Of Subrogation cells remain workable per
          certificate. To change what prints here, open an endorsement ticket
          first.
        </p>
      </details>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-3">
      <p className="eyebrow">Coverage Data — Locked</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        Coverage rows, limits, and insurer identity print from the schedule of
        record and are not editable. Holder, description, and the Additional
        Insured / Waiver Of Subrogation cells remain workable per certificate.
      </p>
      <div className="mt-2 space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Open Endorsements That Can Unlock Editing
        </p>
        {tickets.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--rule)] bg-white px-2 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-[var(--ink)]">
                {t.label} · {t.status}
              </p>
              <p className="truncate text-[10px] text-[var(--muted)]">
                {t.subject}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUnlock(t.id)}
              className="shrink-0 rounded-lg border border-[var(--rule)] bg-[var(--paper)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)] transition hover:border-[var(--gold)]"
            >
              Unlock
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————————————————————————— Desk corrections ————————————————————————— */

/** Section name across both form registries, for the corrections list. */
function sectionName(key: string): string {
  for (const form of Object.values(CERT_FORMS)) {
    const def = form.sections.find((s) => s.key === key);
    if (def) return def.name;
  }
  return key;
}

/** ISO timestamp → MM/DD/YYYY for provenance chips. */
function ruleDate(iso: string): string {
  return mdy(iso.slice(0, 10));
}

/**
 * Every placement rule the desk has taught this account, with provenance and
 * a Remove Rule control — learned behavior stays visible and revocable.
 */
function DeskCorrections({
  accountId,
  rules,
  policies,
  form,
}: {
  accountId: string;
  rules: PlacementRuleView[];
  policies: Policy[];
  form: CertFormDef;
}) {
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-white p-3">
      <p className="eyebrow">Desk Corrections</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
        Placement rules the desk taught this account. Every future render
        honors them; remove one and the coverage matcher takes back over.
      </p>
      <ul className="mt-2 space-y-1.5">
        {rules.map((r) => {
          const policy = policies.find((p) => p.id === r.policyId);
          const stillOnForm = form.sections.some((s) => s.key === r.sectionKey);
          return (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--rule)] bg-[var(--paper)] px-2 py-1.5"
            >
              <p className="text-[11px] font-semibold text-[var(--ink)]">
                {policy?.policyNumber ?? r.policyId} → {sectionName(r.sectionKey)}
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Corrected By {r.correctedBy} — {ruleDate(r.createdAt)}
                {r.movedFrom ? ` · Was: ${r.movedFrom}` : ""}
                {!stillOnForm ? " · Not A Section On This Form" : ""}
              </p>
              <form action={removePlacementRuleAction} className="mt-1">
                <input type="hidden" name="accountId" value={accountId} />
                <input type="hidden" name="ruleId" value={r.id} />
                <button
                  type="submit"
                  className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100"
                >
                  Remove Rule
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The provenance chip on a row a desk rule placed. Prints nothing — the
 * printed sheet is clean paper; provenance is a screen affordance.
 */
function PlacementRuleChip({
  accountId,
  rule,
}: {
  accountId: string;
  rule: PlacementRuleView;
}) {
  return (
    <span className="no-print mb-0.5 flex flex-wrap items-center gap-1">
      <span
        className={`${CHIP_BASE} border-sky-300 bg-sky-50 text-sky-800`}
        title={`Corrected by ${rule.correctedBy}${rule.movedFrom ? ` — was ${rule.movedFrom}` : ""}`}
      >
        Placement Corrected By Desk — {ruleDate(rule.createdAt)}
      </span>
      <form action={removePlacementRuleAction} className="inline">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="ruleId" value={rule.id} />
        <button
          type="submit"
          title="Revoke this placement rule — the coverage matcher takes back over"
          className={`${CHIP_BASE} border-[var(--rule)] bg-white text-[var(--muted)] hover:text-rose-700`}
        >
          Remove Rule
        </button>
      </form>
    </span>
  );
}

/**
 * The correction affordance on a stray/other row: the operator says which
 * coverage section the policy belongs in, and the desk learns it — the sheet
 * fixes now, and the rule persists for every future render.
 */
function CorrectPlacement({
  accountId,
  policyId,
  movedFrom,
  form,
}: {
  accountId: string;
  policyId: string;
  movedFrom: string;
  form: CertFormDef;
}) {
  return (
    <form
      action={correctPlacementAction}
      className="no-print mt-1 flex flex-wrap items-center gap-1"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="movedFrom" value={movedFrom} />
      <label className="text-[7px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Belongs In:
      </label>
      <select
        name="sectionKey"
        defaultValue={form.sections[0]?.key}
        className="rounded border border-[var(--rule)] bg-white px-1 py-0.5 text-[8px] text-[var(--ink)]"
      >
        {form.sections.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className={`${CHIP_BASE} border-sky-600 bg-sky-600 text-white`}
        title="Fix this sheet now and teach the desk — the rule persists for every future render"
      >
        Correct It
      </button>
    </form>
  );
}

/** A verifier finding with, when the ask maps to a service request, the desk's price history. */
function FindingNote({
  f,
  guidance,
}: {
  f: SheetFinding;
  guidance: Record<string, PriceGuidance>;
}) {
  const flagKey = f.finding.id.startsWith("flag-")
    ? (f.finding.id.slice(5) as keyof CoiFlags)
    : null;
  const askType = flagKey ? FLAG_REQUEST_TYPE[flagKey] : null;
  return (
    <div
      className={`mt-1 rounded-md border px-2 py-1 text-[10px] leading-relaxed ${
        f.finding.severity === "reject"
          ? "border-rose-200 bg-rose-50/80 text-rose-900"
          : "border-amber-200 bg-amber-50/70 text-amber-900"
      }`}
    >
      <span className="font-semibold">{f.finding.title}</span>
      {f.policyNumber !== "—" && (
        <span className="opacity-70"> · {f.policyNumber}</span>
      )}
      <p className="mt-0.5 opacity-90">{f.finding.detail}</p>
      {f.finding.fix && <p className="mt-0.5 italic opacity-75">{f.finding.fix}</p>}
      {askType && (
        <PriceGuidanceNote
          guidance={getGuidance(guidance, f.carrier, askType)}
          carrier={f.carrier}
          requestType={askType}
        />
      )}
    </div>
  );
}

function ChecksPanel({
  findings,
  guidance,
}: {
  findings: SheetFinding[];
  guidance: Record<string, PriceGuidance>;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">Checks</p>
      <ul className="space-y-1.5">
        {findings.map((f) => (
          <li key={`${f.policyNumber}-${f.finding.id}-${f.fieldId ?? ""}`}>
            <FindingNote f={f} guidance={guidance} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every ask the desk has real quote history for, per carrier on the cert. */
function PriceSignals({
  guidance,
  carriers,
}: {
  guidance: Record<string, PriceGuidance>;
  carriers: string[];
}) {
  const relevant = Object.values(guidance).filter((g) =>
    carriers.includes(g.carrier),
  );
  if (relevant.length === 0) return null;
  return (
    <details className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        Price Signals — {relevant.length} Ask
        {relevant.length === 1 ? "" : "s"} With Desk History
      </summary>
      <div className="mt-2 space-y-2">
        {relevant.map((g) => (
          <div key={`${g.carrier}-${g.requestType}`}>
            <p className="text-[11px] font-semibold text-[var(--ink)]">
              {g.carrier} — {getRequestType(g.requestType).label}
            </p>
            <PriceGuidanceNote
              guidance={g}
              carrier={g.carrier}
              requestType={g.requestType}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

/* ————————————————————————— Sheet primitives ————————————————————————— */

function In({
  id,
  def,
  ctx,
  className,
  ph,
}: {
  id: string;
  def: string;
  ctx: SheetCtx;
  className?: string;
  ph?: string;
}) {
  if (ctx.locked(id)) {
    // Locked to the schedule of record — plain tabular text, no input.
    return (
      <span
        title="Locked To The Schedule Of Record"
        className={`acord-in acord-ro ${fieldTint(ctx, id)} ${className ?? ""}`}
      >
        {effStr(ctx.overrides, id, def) || "\u00A0"}
      </span>
    );
  }
  return (
    <input
      value={effStr(ctx.overrides, id, def)}
      placeholder={ph}
      onChange={(e) => ctx.setOverride(id, e.target.value)}
      className={`acord-in ${fieldTint(ctx, id)} ${className ?? ""}`}
    />
  );
}

/** Visual rows for the half-width holder box: hard newlines plus soft wraps
    at ~50 chars (the description box calibrates 100 chars across the full
    sheet). Overestimating only nudges the box taller; underestimating would
    scroll-clip on paper, so round up. */
function holderBoxRows(text: string, min: number): number {
  const rows = text
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 50)), 0);
  return Math.max(min, rows);
}

function Ck({ id, def, ctx }: { id: string; def: boolean; ctx: SheetCtx }) {
  const on = effBool(ctx.overrides, id, def);
  if (ctx.locked(id)) {
    return (
      <span
        title="Locked To The Schedule Of Record"
        className={`acord-ck acord-ro ${fieldTint(ctx, id)}`}
      >
        {on ? "✓" : ""}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => ctx.setOverride(id, !on)}
      className={`acord-ck ${fieldTint(ctx, id)}`}
      aria-pressed={on}
    >
      {on ? "✓" : ""}
    </button>
  );
}

/** ADDL INSD / SUBR WVD cell — prints "Y" only when the box is claimed. */
function YCell({ id, def, ctx }: { id: string; def: boolean; ctx: SheetCtx }) {
  const on = effBool(ctx.overrides, id, def);
  return (
    <button
      type="button"
      onClick={() => ctx.setOverride(id, !on)}
      title="Toggle Y / blank"
      className={`acord-ycell ${fieldTint(ctx, id)}`}
    >
      {on ? "Y" : ""}
    </button>
  );
}

/* ————————————————————————— The ACORD 25 sheet ————————————————————————— */

function AcordSheet({
  packet,
  sheet,
  form,
  ctx,
  specimen,
  accountId,
  ruleByPolicy,
  holderName,
  setHolderName,
  holderAddress,
  setHolderAddress,
  holderCheck,
  holderAddressOk,
  signed,
  canSign,
  onSign,
  onClearSign,
}: {
  packet: CertificatePacket;
  sheet: Acord25Sheet;
  form: CertFormDef;
  ctx: SheetCtx;
  /** Non-issued rendering — the Specimen watermark bakes into the artifact */
  specimen: boolean;
  accountId: string;
  ruleByPolicy: Map<string, PlacementRuleView>;
  holderName: string;
  setHolderName: (v: string) => void;
  holderAddress: string;
  setHolderAddress: (v: string) => void;
  holderCheck: Check<AddressVerdict>;
  holderAddressOk: boolean;
  signed: boolean;
  canSign: boolean;
  onSign: () => void;
  onClearSign: () => void;
}) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const insured = packet.sections[0]?.draft.insuredName ?? packet.account.name;

  // INSURED box address — defaults straight off the account record, editable
  // like every header field. The effective (override-aware) value feeds the
  // verifier so the chip always describes what is actually on the sheet.
  const acct = packet.account;
  const insuredAddr1 = effStr(ctx.overrides, "insured.addr1", acct.addressLine1 ?? "");
  const insuredCity = effStr(ctx.overrides, "insured.city", acct.city ?? "");
  const insuredState = effStr(ctx.overrides, "insured.state", acct.state);
  const insuredZip = effStr(ctx.overrides, "insured.zip", acct.zip ?? "");
  // Only a street line is verifiable; a bare city/state claims nothing.
  const insuredOneline = insuredAddr1.trim()
    ? [insuredAddr1, insuredCity, `${insuredState} ${insuredZip}`.trim()]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ")
    : "";
  const insuredCheck = useInsuredAddressCheck(insuredOneline);

  const letters = ["A", "B", "C", "D", "E", "F"];

  return (
    <div
      className="cert-sheet acord relative min-w-[720px] bg-white p-3 shadow-sm"
      data-render-mode={specimen ? "specimen" : "issued"}
    >
      {/* One renderer, two output modes: every non-issued rendering carries
          the diagonal Specimen mark inside the sheet itself, so a screenshot,
          a saved PDF, or a print can never pass as issued paper. Only the
          ledger-recorded issuance renders clean. */}
      {specimen && (
        <div className="cert-watermark" aria-hidden="true">
          <span>Specimen — Not Issued</span>
          <span>Specimen — Not Issued</span>
          <span>Specimen — Not Issued</span>
        </div>
      )}
      {/* Header: logo · title · date */}
      <div className="acord-box flex items-stretch">
        <div className="w-[18%] border-r border-[var(--acord-line)] px-2 py-1">
          <p className="font-display text-[17px] font-bold italic tracking-tight">
            ACORD<span className="align-super text-[8px]">®</span>
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center px-2">
          <p className="text-[13px] font-bold tracking-wide">{form.title}</p>
        </div>
        <div className="w-[16%] border-l border-[var(--acord-line)] px-1.5 py-0.5">
          <p className="acord-lbl">DATE (MM/DD/YYYY)</p>
          <In id="date" def={today} ctx={ctx} className="text-center" />
        </div>
      </div>

      <div className="acord-box mt-[-1px] px-1.5 py-0.5">
        <p className="text-[7.2px] font-bold leading-snug">
          THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS
          NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT
          AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE
          AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT
          CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED
          REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.
        </p>
      </div>
      <div className="acord-box mt-[-1px] px-1.5 py-0.5">
        <p className="text-[7.2px] leading-snug">
          <span className="font-bold">IMPORTANT:</span> If the certificate
          holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL
          INSURED provisions or be endorsed. If SUBROGATION IS WAIVED, subject
          to the terms and conditions of the policy, certain policies may
          require an endorsement. A statement on this certificate does not
          confer rights to the certificate holder in lieu of such
          endorsement(s).
        </p>
      </div>

      {/* Producer / contact / insured / insurers */}
      <div className="acord-box mt-[-1px] flex">
        <div className="relative w-1/2 border-r border-[var(--acord-line)]">
          <AreaChip area="header" ctx={ctx} className="absolute right-1 top-1 z-10" />
          <div className="px-1.5 py-0.5">
            <p className="acord-lbl">PRODUCER</p>
            <In id="producer.name" def={PRODUCER.name} ctx={ctx} />
            <In id="producer.addr1" def={PRODUCER.addressLine1} ctx={ctx} />
            <In id="producer.addr2" def={PRODUCER.addressLine2} ctx={ctx} />
            {/* State/ZIP need `!w-*`: `.acord-in { width: 100% }` is unlayered
                and would otherwise beat Tailwind's layered width utilities,
                squeezing the flex-1 city cell to nothing. */}
            <div className="flex gap-1">
              <In id="producer.city" def={PRODUCER.city} ctx={ctx} className="min-w-0 flex-1" />
              <In id="producer.state" def={PRODUCER.state} ctx={ctx} className="!w-8 text-center" />
              <In id="producer.zip" def={PRODUCER.zip} ctx={ctx} className="!w-14 text-center" />
            </div>
          </div>
          <div className="border-t border-[var(--acord-line)] px-1.5 py-0.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <p className="acord-lbl">INSURED</p>
              <span className="no-print">
                <InsuredAddressChip
                  check={insuredCheck}
                  onApplyVerified={(s) => {
                    ctx.setOverride("insured.addr1", s.line1);
                    ctx.setOverride("insured.city", s.city);
                    ctx.setOverride("insured.state", s.state);
                    ctx.setOverride("insured.zip", s.zip);
                  }}
                />
              </span>
            </div>
            <In id="insured.name" def={insured} ctx={ctx} className="font-semibold" />
            <In id="insured.addr1" def={acct.addressLine1 ?? ""} ctx={ctx} ph=" " />
            <In id="insured.addr2" def="" ctx={ctx} ph=" " />
            <div className="flex gap-1">
              <In id="insured.city" def={acct.city ?? ""} ctx={ctx} className="min-w-0 flex-1" ph=" " />
              <In id="insured.state" def={acct.state} ctx={ctx} className="!w-8 text-center" ph=" " />
              <In id="insured.zip" def={acct.zip ?? ""} ctx={ctx} className="!w-14 text-center" ph=" " />
            </div>
          </div>
        </div>
        <div className="w-1/2">
          <div className="flex border-b border-[var(--acord-line)]">
            <p className="acord-lbl w-[24%] border-r border-[var(--acord-line)] px-1 py-0.5">
              CONTACT
              <br />
              NAME:
            </p>
            <div className="flex-1 px-1 py-0.5">
              <In id="producer.contact" def={PRODUCER.contactName} ctx={ctx} />
            </div>
          </div>
          <div className="flex border-b border-[var(--acord-line)]">
            <p className="acord-lbl w-[24%] border-r border-[var(--acord-line)] px-1 py-0.5">
              PHONE
              <br />
              (A/C, No, Ext):
            </p>
            <div className="flex-1 border-r border-[var(--acord-line)] px-1 py-0.5">
              <In id="producer.phone" def={PRODUCER.phone} ctx={ctx} />
            </div>
            <p className="acord-lbl w-[14%] border-r border-[var(--acord-line)] px-1 py-0.5">
              FAX
              <br />
              (A/C, No):
            </p>
            <div className="w-[16%] px-1 py-0.5">
              <In id="producer.fax" def={PRODUCER.fax} ctx={ctx} />
            </div>
          </div>
          <div className="flex border-b border-[var(--acord-line)]">
            <p className="acord-lbl w-[24%] border-r border-[var(--acord-line)] px-1 py-0.5">
              E-MAIL
              <br />
              ADDRESS:
            </p>
            <div className="flex-1 px-1 py-0.5">
              <In id="producer.email" def={PRODUCER.email} ctx={ctx} />
            </div>
          </div>
          <div className="relative flex border-b border-[var(--acord-line)] bg-[var(--paper)]">
            <AreaChip
              area="insurers"
              ctx={ctx}
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2"
            />
            <p className="flex-1 px-1 py-0.5 text-center text-[7px] font-bold">
              INSURER(S) AFFORDING COVERAGE
            </p>
            <p className="w-[15%] border-l border-[var(--acord-line)] px-1 py-0.5 text-center text-[7px] font-bold">
              NAIC #
            </p>
          </div>
          {letters.map((letter, i) => {
            const ins = packet.insurers.find((x) => x.letter === letter);
            return (
              <div
                key={letter}
                className={`flex ${i < letters.length - 1 ? "border-b border-[var(--acord-line)]" : ""}`}
              >
                <p className="acord-lbl w-[24%] shrink-0 border-r border-[var(--acord-line)] px-1 py-0.5">
                  INSURER {letter} :
                </p>
                <div className="min-w-0 flex-1 px-1 py-0.5">
                  {/* The issuing company's legal name off the verified NAIC
                      registry — never the MGA. Unverified brands print the
                      policy-record name. */}
                  <In
                    id={`insurer.${letter}`}
                    def={ins ? (ins.issuingCompany ?? ins.carrier) : ""}
                    ctx={ctx}
                  />
                </div>
                <div className="w-[15%] shrink-0 border-l border-[var(--acord-line)] px-1 py-0.5">
                  {/* Verified code or blank — an unverified NAIC never prints */}
                  <In
                    id={`naic.${letter}`}
                    def={ins?.naic ?? ""}
                    ctx={ctx}
                    className="text-center"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Coverages bar */}
      <div className="acord-box mt-[-1px] flex items-center bg-[var(--paper)]">
        <p className="w-[14%] px-1.5 py-0.5 text-[8px] font-bold">COVERAGES</p>
        {form.hasProdCustomerId && (
          <div className="flex w-[22%] items-center gap-1 border-l border-[var(--acord-line)] px-1.5 py-0.5">
            <span className="text-[8px] font-bold">PROD / CUSTOMER ID:</span>
            <In id="prodCustomerId" def="" ctx={ctx} className="flex-1" />
          </div>
        )}
        <div className="flex flex-1 items-center gap-1 border-l border-[var(--acord-line)] px-1.5 py-0.5">
          <span className="text-[8px] font-bold">CERTIFICATE NUMBER:</span>
          <In id="certNumber" def="" ctx={ctx} className="flex-1" />
        </div>
        <div className="flex w-[26%] items-center gap-1 border-l border-[var(--acord-line)] px-1.5 py-0.5">
          <span className="text-[8px] font-bold">REVISION NUMBER:</span>
          <In id="revision" def="" ctx={ctx} className="flex-1" />
        </div>
      </div>
      {/* Certification paragraph. ACORD 25 carries the 2025/12 wording
          (asterisked paid-claims sentence, inclusive-limits sentence, bold WY
          footnote inside the same box — docs/acord-forms-research.md §5.1);
          ACORD 30 (2016/03) keeps the prior sentence. */}
      <div className="acord-box mt-[-1px] px-1.5 py-0.5">
        <p className="text-[7.2px] leading-snug">
          THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE
          BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD
          INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY
          CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY
          BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES
          DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND
          CONDITIONS OF SUCH POLICIES.{" "}
          {form.key === "acord25" ? (
            <>
              *LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS. LIMITS SHOWN
              ARE INCLUSIVE OF AMOUNTS REQUESTED BY THE CERTIFICATE HOLDER AND
              MAY NOT REFLECT POLICY LIMIT AMOUNTS IN EXCESS OF THOSE
              REQUESTED. <span className="font-bold">*Not Applicable in WY</span>
            </>
          ) : (
            <>LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.</>
          )}
        </p>
      </div>

      {/* The coverage grid */}
      <table className="acord-grid mt-[-1px]">
        <colgroup>
          <col className="w-[3.5%]" />
          <col className="w-[26%]" />
          <col className="w-[3.5%]" />
          <col className="w-[3.5%]" />
          <col className="w-[17%]" />
          <col className="w-[8.5%]" />
          <col className="w-[8.5%]" />
          <col className="w-[18.5%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr className="bg-[var(--paper)] text-[6.4px]">
            <th>
              INSR
              <br />
              LTR
            </th>
            <th className="!text-center">TYPE OF INSURANCE</th>
            <th>
              ADDL
              <br />
              INSD
            </th>
            <th>
              SUBR
              <br />
              WVD
            </th>
            <th className="!text-center">POLICY NUMBER</th>
            <th>
              POLICY EFF
              <br />
              (MM/DD/YYYY)
            </th>
            <th>
              POLICY EXP
              <br />
              (MM/DD/YYYY)
            </th>
            <th colSpan={2} className="!text-center">
              LIMITS
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.sections.map((rs) => (
            <SectionBlock
              key={rs.def.key}
              rs={rs}
              ctx={ctx}
              accountId={accountId}
              rule={
                rs.placedByRule && rs.feeder
                  ? ruleByPolicy.get(rs.feeder.policy.id)
                  : undefined
              }
            />
          ))}
          {sheet.others.map((row, i) => (
            <OtherBlock
              key={i}
              row={row}
              i={i}
              ctx={ctx}
              accountId={accountId}
              form={form}
            />
          ))}
        </tbody>
      </table>

      {/* Description of operations (ACORD 25) / Remarks (ACORD 30).
          Default text = endorsement wording + one schedule-backed overflow
          line per coverage beyond the printed rows; the box grows with its
          content so overflow lines never clip on screen or paper. */}
      <div className="acord-box mt-[-1px] px-1.5 py-0.5">
        <p className="flex items-start justify-between gap-2 text-[7px] font-bold">
          <span>
            {form.remarksHead}{" "}
            <span className="font-normal">{form.remarksNote}</span>
          </span>
          <AreaChip area="desc" ctx={ctx} className="shrink-0" />
        </p>
        {(() => {
          const descText = effStr(
            ctx.overrides,
            "desc",
            certDescription(packet, sheet),
          );
          // Visual rows ≈ hard newlines + soft wraps, so nothing scroll-clips
          // when the sheet prints (textareas never print hidden overflow).
          const descRows = descText
            .split("\n")
            .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 100)), 0);
          return (
            <textarea
              value={descText}
              onChange={(e) => ctx.setOverride("desc", e.target.value)}
              rows={Math.max(4, descRows + 1)}
              className={`acord-ta mt-0.5 ${fieldTint(ctx, "desc")}`}
            />
          );
        })()}
      </div>

      {/* Holder / cancellation */}
      <div className="acord-box mt-[-1px] flex">
        <div className="w-1/2 border-r border-[var(--acord-line)] px-1.5 py-0.5">
          <p className="flex items-start justify-between gap-2 text-[8px] font-bold">
            <span>CERTIFICATE HOLDER</span>
            <span className="no-print flex shrink-0 items-center gap-1">
              <AddressStatusChip
                check={holderCheck}
                onApplyStandardized={setHolderAddress}
              />
              <AreaChip area="holder" ctx={ctx} className="shrink-0" />
            </span>
          </p>
          {/* Auto-growing fields: a long municipal holder name (~140 chars)
              must print in full — textareas sized to their content never
              scroll-clip on paper, and the box only grows downward. */}
          <textarea
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Holder name"
            rows={holderBoxRows(holderName, 1)}
            className={`acord-ta mt-2 font-semibold ${fieldTint(ctx, "holder.name")}`}
          />
          <textarea
            value={holderAddress}
            onChange={(e) => setHolderAddress(e.target.value)}
            placeholder="Holder address"
            rows={holderBoxRows(holderAddress, 3)}
            className={`acord-ta mt-0.5 ${holderAddressOk ? "" : "is-bad"} ${fieldTint(ctx, "holder.address")}`}
          />
        </div>
        <div className="flex w-1/2 flex-col">
          <div className="px-1.5 py-0.5">
            <p className="text-[8px] font-bold">CANCELLATION</p>
            <p className="mt-1 px-2 text-[7.2px] font-bold leading-snug">
              SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE
              EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE
              WITH THE POLICY PROVISIONS.
            </p>
          </div>
          <div className="mt-auto border-t border-[var(--acord-line)] px-1.5 py-0.5">
            <p className="acord-lbl">AUTHORIZED REPRESENTATIVE</p>
            <div className="flex min-h-9 items-end justify-between gap-2 px-2 pb-0.5">
              {signed ? (
                <>
                  {/* The one standard signature — pasted DocuSign-style
                      stamp, identical on every issue. */}
                  <span className="sig-stamp" data-testid="authorized-signature">
                    <span className="acord-sig">{AUTHORIZED_REPRESENTATIVE}</span>
                    <span className="sig-caption">
                      Digitally Applied · {today}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onClearSign}
                    className="no-print text-[8px] uppercase tracking-wide text-[var(--muted)] underline"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onSign}
                  disabled={!canSign}
                  title={
                    canSign
                      ? `Stamp the standard signature — ${AUTHORIZED_REPRESENTATIVE}. Sign & Issue applies it automatically.`
                      : "Available once every area is confirmed and verification is clean"
                  }
                  className="no-print rounded border border-[var(--gold)] bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ink)] disabled:opacity-40"
                >
                  Apply Signature
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-0.5 text-right text-[7.5px] font-bold">{form.copyright}</p>
      <div className="flex items-center justify-between">
        <p className="text-[8px] font-bold">
          {form.formNumber} ({form.edition})
        </p>
        <p className="text-[7.5px]">
          The ACORD name and logo are registered marks of ACORD
        </p>
        <span />
      </div>
    </div>
  );
}

/* ————————————————————————— Coverage grid rows ————————————————————————— */

function TypeCellView({ rs, ctx }: { rs: ResolvedSection; ctx: SheetCtx }) {
  const sec = rs.def.key;
  return (
    <>
      {rs.def.typeCell.map((line, i) => {
        if (line.kind === "title") {
          return (
            <p key={i} className="text-[7px] font-bold uppercase leading-tight">
              {line.text}
            </p>
          );
        }
        if (line.kind === "text") {
          return (
            <p key={i} className="mt-0.5 text-[6.6px] uppercase leading-tight">
              {line.text}
            </p>
          );
        }
        return (
          <p key={i} className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-tight">
            {line.pre && (
              <span className="w-full text-[6.6px] uppercase">{line.pre}</span>
            )}
            {line.items.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1">
                <Ck
                  id={`${sec}.check.${item.key}`}
                  def={rs.checks[item.key] ?? false}
                  ctx={ctx}
                />
                {item.label && (
                  <span
                    className={`text-[6.8px] uppercase ${item.bold ? "font-bold" : ""}`}
                  >
                    {item.label}
                  </span>
                )}
                {item.writeInKey && (
                  <In
                    id={`${sec}.writein.${item.writeInKey}`}
                    def=""
                    ctx={ctx}
                    className="!w-16 border-b border-[var(--acord-line)]/60"
                  />
                )}
              </span>
            ))}
            {line.post && (
              <span className="text-[6.6px] uppercase">{line.post}</span>
            )}
          </p>
        );
      })}
    </>
  );
}

function IdentityCells({
  sec,
  span,
  refP,
  ctx,
  typeCell,
}: {
  sec: string;
  span: number;
  refP: {
    insurerLetter: string;
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    additionalInsured: boolean;
    subrogationWaived: boolean;
  } | null;
  ctx: SheetCtx;
  typeCell: React.ReactNode;
}) {
  return (
    <>
      <td rowSpan={span} className="text-center text-[9px] font-bold">
        {refP?.insurerLetter ?? ""}
      </td>
      <td rowSpan={span}>{typeCell}</td>
      <td rowSpan={span} className="!p-0 text-center">
        <YCell id={`${sec}.addl`} def={refP?.additionalInsured ?? false} ctx={ctx} />
      </td>
      <td rowSpan={span} className="!p-0 text-center">
        <YCell id={`${sec}.subr`} def={refP?.subrogationWaived ?? false} ctx={ctx} />
      </td>
      <td rowSpan={span}>
        <In
          id={`${sec}.policyNumber`}
          def={refP?.policyNumber ?? ""}
          ctx={ctx}
          className="font-mono !text-[7.5px]"
        />
      </td>
      <td rowSpan={span}>
        <In
          id={`${sec}.eff`}
          def={mdy(refP?.effectiveDate)}
          ctx={ctx}
          className="text-center tabular-nums"
        />
      </td>
      <td rowSpan={span}>
        <In
          id={`${sec}.exp`}
          def={mdy(refP?.expirationDate)}
          ctx={ctx}
          className="text-center tabular-nums"
        />
      </td>
    </>
  );
}

function LimitCells({
  id,
  label,
  def,
  ctx,
  check,
  loc,
}: {
  id: string;
  label: React.ReactNode;
  def: string;
  ctx: SheetCtx;
  /** Perils checkbox inside the row (ACORD 30 garagekeepers) */
  check?: { id: string; def: boolean };
  /** Per-location write-in between the label and the $ box */
  loc?: { id: string; def: string };
}) {
  return (
    <>
      <td className="text-[6.8px] uppercase leading-tight">
        {check || loc ? (
          <span className="flex items-center gap-1">
            {check && <Ck id={check.id} def={check.def} ctx={ctx} />}
            <span className="min-w-0 flex-1">{label}</span>
            {loc && (
              <span className="inline-flex shrink-0 items-center gap-0.5">
                <span className="text-[6.4px]">LOC</span>
                <In
                  id={loc.id}
                  def={loc.def}
                  ctx={ctx}
                  className="!w-12 border-b border-[var(--acord-line)]/60 text-center"
                />
              </span>
            )}
          </span>
        ) : (
          label
        )}
      </td>
      <td className="whitespace-nowrap">
        <span className="flex items-center gap-0.5">
          <span className="text-[7px]">$</span>
          <In id={id} def={def} ctx={ctx} className="tabular-nums font-semibold" />
        </span>
      </td>
    </>
  );
}

/**
 * Every limit box in this section is blank because no dec page is on file —
 * say so. The refusal to state a limit nothing backs is correct; leaving the
 * operator to guess whether it's a refusal or a broken render is not. Screen
 * only: a real ACORD form carries no such line.
 */
function NoScheduleChip() {
  return (
    <span
      title="No schedule of record on file for this policy. The row can identify the policy and nothing else — attach the dec page before any limit can print."
      className="no-print mb-0.5 inline-flex items-center rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-[6.4px] font-bold uppercase tracking-wide text-amber-900"
    >
      No Schedule Of Record
    </span>
  );
}

function SectionBlock({
  rs,
  ctx,
  accountId,
  rule,
}: {
  rs: ResolvedSection;
  ctx: SheetCtx;
  accountId: string;
  rule?: PlacementRuleView;
}) {
  const sec = rs.def.key;
  const boxes = rs.def.limitBoxes;
  const head = rs.def.limitsHead;
  const span = boxes.length + (head ? 1 : 0);
  const tail = head ? boxes : boxes.slice(1);

  const cellsFor = (box: LimitBoxDef) => (
    <LimitCells
      id={`${sec}.limit.${box.key}`}
      label={box.label}
      def={displayLimit(rs.limits[box.key])}
      ctx={ctx}
      check={
        box.check
          ? {
              id: `${sec}.check.${box.check.key}`,
              def: rs.checks[box.check.key] ?? false,
            }
          : undefined
      }
      loc={
        box.withLoc
          ? { id: `${sec}.loc.${box.key}`, def: rs.locs[box.key] ?? "" }
          : undefined
      }
    />
  );

  return (
    <>
      <tr>
        <IdentityCells
          sec={sec}
          span={span}
          refP={rs.ref}
          ctx={ctx}
          typeCell={
            <>
              <AreaChip area={sec} ctx={ctx} className="float-right ml-1 mb-0.5" />
              {rule && <PlacementRuleChip accountId={accountId} rule={rule} />}
              {rs.feeder?.set.unscheduled && <NoScheduleChip />}
              <TypeCellView rs={rs} ctx={ctx} />
            </>
          }
        />
        {head ? (
          <td colSpan={2} className="!py-1">
            <span className="flex items-center gap-2">
              {head.map((item) => (
                <span key={item.key} className="inline-flex items-center gap-1">
                  <Ck
                    id={`${sec}.check.${item.key}`}
                    def={rs.checks[item.key] ?? false}
                    ctx={ctx}
                  />
                  <span className="text-[6.8px] uppercase">{item.label}</span>
                </span>
              ))}
            </span>
          </td>
        ) : (
          cellsFor(boxes[0])
        )}
      </tr>
      {tail.map((box) => (
        <tr key={box.key}>{cellsFor(box)}</tr>
      ))}
    </>
  );
}

function OtherBlock({
  row,
  i,
  ctx,
  accountId,
  form,
}: {
  row: OtherRow;
  i: number;
  ctx: SheetCtx;
  accountId: string;
  form: CertFormDef;
}) {
  const sec = `other${i}`;
  const rowCount = Math.max(row.lines.length, 2);
  const rows = Array.from({ length: rowCount }, (_, j) => row.lines[j] ?? null);

  const limitCells = (j: number) => {
    const line = rows[j];
    if (line) {
      return (
        <LimitCells
          id={`${sec}.limit.${line.slot}`}
          label={line.label}
          def={displayLimit(line.value)}
          ctx={ctx}
        />
      );
    }
    return (
      <LimitCells
        id={`${sec}.limitValue.${j}`}
        label={
          <In id={`${sec}.limitLabel.${j}`} def="" ctx={ctx} className="!text-[6.8px]" />
        }
        def=""
        ctx={ctx}
      />
    );
  };

  return (
    <>
      <tr>
        <IdentityCells
          sec={sec}
          span={rowCount}
          refP={row.ref}
          ctx={ctx}
          typeCell={
            <>
              <AreaChip area={sec} ctx={ctx} className="float-right ml-1 mb-0.5" />
              <In
                id={`${sec}.label`}
                def={row.label}
                ctx={ctx}
                className="!text-[7px] font-bold uppercase"
              />
              {row.feeder && (
                <CorrectPlacement
                  accountId={accountId}
                  policyId={row.feeder.policy.id}
                  movedFrom={row.label || "Additional Row"}
                  form={form}
                />
              )}
            </>
          }
        />
        {limitCells(0)}
      </tr>
      {rows.slice(1).map((_, k) => (
        <tr key={k}>{limitCells(k + 1)}</tr>
      ))}
    </>
  );
}
