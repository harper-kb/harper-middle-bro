"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AUTO_SEND_UNLOCK_AT,
  EDIT_REASONS,
  IN_PLAY_LIMIT,
  docKindLabel,
  type AccountDoc,
  type EditReasonId,
} from "@/lib/aidesk";
import { channelLabel } from "@/lib/channels";
import { coverageLabels } from "@/lib/catalog";
import { buildTicketDraft } from "@/lib/draft";
import { conventionName, describeRename, guessKind } from "@/lib/filenames";
import { formatBytes, relativeAge } from "@/lib/format";
import { sendTicketDraftAction, setTicketStatusAction } from "@/lib/actions";
import { DeskSection } from "./DeskSection";
import { FormsPanel } from "./FormsPanel";
import type { AccountDetail, Operator, TicketDetail, Underwriter } from "@/lib/types";

const DOC_MIME = "application/x-uwdesk-doc";

interface Attachment {
  id: string;
  name: string;
  /** Name as it arrived, kept only to show what the convention replaced */
  originalName: string | null;
  sizeLabel: string;
  source: "account" | "device";
  trusted: boolean;
}

interface LedgerEntry {
  ticketId: string;
  outcome: "confirmed" | "returned";
  edited: boolean;
  reasons: EditReasonId[];
}

/** Everything that lands on a draft gets the house name: `{Holder} - COI.pdf`. */
function renameForHolder(
  original: string,
  holderName: string,
  taken: string[],
): string {
  const guessed = guessKind(original);
  return conventionName({
    entity: holderName,
    kind: guessed === "other" ? "coi" : guessed,
    originalName: original,
    taken,
  });
}

export function AiDesk({
  tickets,
  accounts,
  carrierDesks,
  operator,
  cleanStreak,
  autoSend,
}: {
  tickets: TicketDetail[];
  accounts: AccountDetail[];
  carrierDesks: Underwriter[];
  operator: Operator | null;
  cleanStreak: number;
  autoSend: boolean;
}) {
  // Pacing reads the record, not local state — a sent ticket leaves the lane
  // because it actually moved, not because a checkbox says so.
  const pending = useMemo(
    () =>
      tickets
        .filter((t) => t.status === "intake" || t.status === "drafting")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tickets],
  );
  const inPlay = pending.slice(0, IN_PLAY_LIMIT);
  const paced = pending.slice(IN_PLAY_LIMIT);
  const done = useMemo(
    () => tickets.filter((t) => t.status !== "intake" && t.status !== "drafting"),
    [tickets],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [holderAttest, setHolderAttest] = useState<Record<string, boolean>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, EditReasonId[]>>({});
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending_, startTransition] = useTransition();
  const dragDepth = useRef(0);

  const ticket =
    inPlay.find((t) => t.id === pickedId) ?? inPlay[0] ?? pending[0] ?? null;

  const account = ticket
    ? (accounts.find((a) => a.id === ticket.accountId) ?? null)
    : null;
  const policy = ticket?.policies[0] ?? null;

  const draft =
    ticket && account && policy
      ? buildTicketDraft({ ticket, account, policy, carrierDesks, operator })
      : null;

  const key = ticket?.id ?? "none";
  const body = bodies[key] ?? draft?.body ?? "";
  const edited = bodies[key] !== undefined && bodies[key] !== draft?.body;
  const ticketAttachments = attachments[key] ?? [];
  const ticketReasons = reasons[key] ?? [];
  const attested = holderAttest[key] ?? false;
  const ticketAcked = acked[key] ?? false;

  const blocked = draft ? draft.blocked : true;
  const needsAck = draft?.needsAck ?? false;
  const needsReason = edited && ticketReasons.length === 0;
  const canConfirm =
    Boolean(operator) &&
    Boolean(ticket) &&
    !blocked &&
    attested &&
    (!needsAck || ticketAcked) &&
    !needsReason &&
    !pending_;

  const confirmedCount = done.length;

  function advance(outcome: "confirmed" | "returned") {
    if (!ticket) return;
    setLedger((prev) => [
      ...prev,
      { ticketId: ticket.id, outcome, edited, reasons: ticketReasons },
    ]);
    const next = inPlay.find((t) => t.id !== ticket.id) ?? paced[0] ?? null;
    setPickedId(next?.id ?? null);
  }

  function confirmAndSend() {
    if (!ticket || !policy || !draft) return;
    setError(null);

    const form = new FormData();
    form.set("ticketId", ticket.id);
    form.set("policyId", policy.id);
    form.set("body", body);
    if (ticketAcked) form.set("ackWarnings", "1");
    if (edited) form.set("edited", "1");
    for (const a of ticketAttachments) form.append("attachments", a.name);

    startTransition(async () => {
      try {
        await sendTicketDraftAction(form);
        if (draft.route?.openPortal && draft.route.portalUrl) {
          window.open(draft.route.portalUrl, "_blank", "noopener,noreferrer");
        }
        advance("confirmed");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }

  function returnForReview() {
    if (!ticket) return;
    const form = new FormData();
    form.set("ticketId", ticket.id);
    form.set("status", "needs_you");
    startTransition(async () => {
      await setTicketStatusAction(form);
      advance("returned");
    });
  }

  function addAccountDoc(doc: AccountDoc) {
    if (!ticket) return;
    const holder = ticket.holderName ?? ticket.account.name;
    setAttachments((prev) => {
      const cur = prev[ticket.id] ?? [];
      if (cur.some((a) => a.id === doc.id)) return prev;
      return {
        ...prev,
        [ticket.id]: [
          ...cur,
          {
            id: doc.id,
            name: renameForHolder(doc.name, holder, cur.map((a) => a.name)),
            originalName: doc.name,
            sizeLabel: doc.sizeLabel,
            source: "account",
            trusted: doc.trusted,
          },
        ],
      };
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (!ticket) return;
    const holder = ticket.holderName ?? ticket.account.name;

    const docId = e.dataTransfer.getData(DOC_MIME);
    if (docId) {
      const doc = ticket.docs.find((d) => d.id === docId);
      if (doc) addAccountDoc(doc);
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      setAttachments((prev) => {
        const cur = prev[ticket.id] ?? [];
        const taken = cur.map((a) => a.name);
        const added: Attachment[] = [];
        for (const f of files) {
          const id = `dev-${f.name}-${f.size}`;
          if (cur.some((a) => a.id === id)) continue;
          const name = renameForHolder(f.name, holder, taken);
          taken.push(name);
          added.push({
            id,
            name,
            originalName: f.name,
            sizeLabel: formatBytes(f.size),
            source: "device",
            trusted: true,
          });
        }
        return { ...prev, [ticket.id]: [...cur, ...added] };
      });
    }
  }

  if (!ticket || !account || !policy || !draft) {
    return (
      <div className="glass rounded-2xl px-6 py-16 text-center">
        <p className="font-display text-2xl text-[var(--ink)]">Queue Clear</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Every Additional Insured ticket is out with the market or delivered.
        </p>
        <Link href="/" className="btn-ghost mt-5 inline-block">
          Back To The Queue
        </Link>
      </div>
    );
  }

  const matchedUw = draft.underwriter;
  const route = draft.route;
  const holder = ticket.holderName ?? ticket.account.name;

  return (
    <div className="grid gap-5 xl:grid-cols-[290px_1fr_300px]">
      {/* ————— Queue rail ————— */}
      <aside className="space-y-5">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Pace</p>
            <p className="text-xs text-[var(--muted)]">
              {inPlay.length} in play · {paced.length} held
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
            {autoSend ? (
              <>
                <span className="font-semibold text-emerald-700">
                  Auto-Send Unlocked
                </span>{" "}
                for Additional Insured.
              </>
            ) : (
              <>
                <span className="font-semibold">{cleanStreak}</span> of{" "}
                {AUTO_SEND_UNLOCK_AT} clean sends in a row toward auto-send.
              </>
            )}
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]">
            <div
              className="pace-bar h-full rounded-full"
              style={{
                width: `${Math.min(100, ((autoSend ? AUTO_SEND_UNLOCK_AT : cleanStreak) / AUTO_SEND_UNLOCK_AT) * 100)}%`,
              }}
            />
          </div>
          {confirmedCount > 0 && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {confirmedCount} moved off this desk.
            </p>
          )}
        </div>

        <section>
          <p className="eyebrow mb-2 px-1">In Play</p>
          <div className="space-y-2">
            {inPlay.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPickedId(t.id)}
                className={`queue-card glass w-full rounded-2xl p-3.5 text-left ${
                  t.id === ticket.id ? "queue-card-active" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--ink)]">
                    {t.account.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    {relativeAge(t.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {t.subject}
                </p>
                <p className="mt-1.5 truncate text-xs text-[var(--ink)]/80">
                  AI · {t.holderName ?? "Holder TBD"}
                </p>
              </button>
            ))}
            {inPlay.length === 0 && (
              <p className="rounded-2xl border border-dashed border-[var(--rule)] px-4 py-6 text-center text-xs text-[var(--muted)]">
                Queue clear. Nicely done.
              </p>
            )}
          </div>
        </section>

        {paced.length > 0 && (
          <DeskSection title="Held For Pacing" count={paced.length} flush>
            <ul
              className="divide-y divide-[var(--rule)]"
              title="Released one at a time as you confirm — mastery before speed."
            >
              {paced.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline justify-between gap-3 px-3.5 py-2 opacity-70"
                >
                  <span className="truncate text-xs font-medium text-[var(--ink)]">
                    {t.account.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    {relativeAge(t.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </DeskSection>
        )}

        {done.length > 0 && (
          <DeskSection title="Moved On" count={done.length} flush>
            <ul className="divide-y divide-[var(--rule)]">
              {done.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="row-link flex items-center gap-2 px-3.5 py-2"
                  >
                    <span
                      className={`tick-pop text-sm ${
                        t.status === "needs_you"
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }`}
                    >
                      {t.status === "needs_you" ? "↩" : "✓"}
                    </span>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {t.account.name}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </DeskSection>
        )}
      </aside>

      {/* ————— Workbench ————— */}
      <section key={ticket.id} className="rise-in space-y-4">
        <div className="glass rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Request</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink)]">
                {ticket.subject}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {ticket.requestedBy} · {relativeAge(ticket.createdAt)} old
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="chip">{policy.carrier}</span>
              <Link href={`/tickets/${ticket.id}`} className="btn-ghost text-xs">
                Open Ticket
              </Link>
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="glass rounded-2xl p-5">
          <p className="eyebrow mb-3">Mastery Checklist</p>
          <ol className="space-y-3">
            <CheckRow
              state={
                draft.verify.issues.some((i) => i.severity === "block")
                  ? "block"
                  : draft.verify.matchSource !== "primary"
                    ? "warn"
                    : "ok"
              }
              title="Underwriter Matched To This Policy's Carrier"
              detail={
                matchedUw
                  ? `${matchedUw.name} · ${matchedUw.carrier}${draft.verify.matchSource !== "primary" ? " (re-matched from account primary)" : ""}`
                  : "No desk on file for this carrier — fix Contacts first."
              }
            />
            <CheckRow
              state={
                draft.verify.issues.some(
                  (i) =>
                    i.id === "quote-name-mismatch" ||
                    i.id === "quote-carrier-mismatch",
                )
                  ? "block"
                  : draft.verify.issues.some((i) => i.id === "quote-name-missing")
                    ? "warn"
                    : "ok"
              }
              title="Quote On File Matches The Account"
              detail={
                policy.quoteInsuredName
                  ? `Quote says “${policy.quoteInsuredName}” · ${policy.quoteCarrier ?? "carrier n/a"}`
                  : "No quote named insured on file — verify before sending."
              }
            />
            <CheckRow
              state={attested ? "ok" : "todo"}
              title="Holder Is The Entity To Be Added"
              detail={`${holder}${ticket.holderAddress ? ` — ${ticket.holderAddress}` : ""}`}
              action={
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) =>
                      setHolderAttest((p) => ({ ...p, [ticket.id]: e.target.checked }))
                    }
                  />
                  Verified against the contract
                </label>
              }
            />
            <CheckRow
              state="ok"
              title="Right Channel, No Paperwork Theater"
              detail={
                route
                  ? `${channelLabel(route.primary)} — ${route.instruction}`
                  : "Route resolves once UW matches."
              }
            />
          </ol>

          {draft.verify.issues.length > 0 && (
            <div
              className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                blocked ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"
              }`}
            >
              {draft.verify.issues.map((i) => (
                <p key={i.id} className="leading-relaxed">
                  <span className="font-semibold">
                    {i.severity === "block" ? "Stop — " : "Note — "}
                  </span>
                  {i.detail}
                </p>
              ))}
              {needsAck && !blocked && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={ticketAcked}
                    onChange={(e) =>
                      setAcked((p) => ({ ...p, [ticket.id]: e.target.checked }))
                    }
                  />
                  Reviewed — proceed with the matched underwriter
                </label>
              )}
            </div>
          )}
        </div>

        {/* Draft */}
        <div className="glass rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Draft</p>
            <p className="text-xs text-[var(--muted)]">
              {route?.sendEmail
                ? `To ${matchedUw?.email ?? "—"}`
                : route
                  ? `${channelLabel(route.primary)} task — logged, not emailed`
                  : ""}
            </p>
          </div>

          <textarea
            value={body}
            onChange={(e) => setBodies((p) => ({ ...p, [ticket.id]: e.target.value }))}
            rows={12}
            className="field mt-3 font-mono text-[13px] leading-relaxed"
          />

          {edited && (
            <div className="mt-3 rounded-xl bg-[var(--sand)]/70 px-4 py-3">
              <p className="text-xs font-semibold text-[var(--ink)]">
                You Changed The Draft — Tag Why, So The Desk Learns
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EDIT_REASONS.map((r) => {
                  const on = ticketReasons.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setReasons((p) => {
                          const cur = p[ticket.id] ?? [];
                          return {
                            ...p,
                            [ticket.id]: on
                              ? cur.filter((x) => x !== r.id)
                              : [...cur, r.id],
                          };
                        })
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "bg-[var(--ink)] text-white"
                          : "bg-white text-[var(--ink)] ring-1 ring-[var(--rule)]"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attachments + dropzone */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragOver(true);
            }}
            onDragLeave={() => {
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) setDragOver(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`dropzone mt-4 rounded-2xl px-4 py-5 ${dragOver ? "dropzone-hot" : ""}`}
          >
            {ticketAttachments.length === 0 ? (
              <div className="text-center">
                <p className="text-sm text-[var(--muted)]">
                  Drop files here — from your desktop, or drag a document in from{" "}
                  <span className="font-medium text-[var(--ink)]">On File</span> →
                </p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Renamed on arrival to{" "}
                  <span className="font-medium text-[var(--ink)]">
                    {holder} - COI
                  </span>
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ticketAttachments.map((a) => (
                  <span
                    key={a.id}
                    title={
                      a.originalName
                        ? (describeRename(a.originalName, a.name) ?? a.name)
                        : a.name
                    }
                    className="tick-pop inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm ring-1 ring-[var(--rule)]"
                  >
                    <span aria-hidden>📎</span>
                    <span className="font-medium text-[var(--ink)]">{a.name}</span>
                    <span className="text-[var(--muted)]">{a.sizeLabel}</span>
                    {a.originalName && a.originalName !== a.name && (
                      <span className="rounded-full bg-[var(--sand)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                        Renamed
                      </span>
                    )}
                    {!a.trusted && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Reference Only
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((p) => ({
                          ...p,
                          [ticket.id]: (p[ticket.id] ?? []).filter(
                            (x) => x.id !== a.id,
                          ),
                        }))
                      }
                      className="text-[var(--muted)] hover:text-[var(--coral)]"
                      aria-label={`Remove ${a.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-900">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={confirmAndSend}
              className="btn-primary px-6 py-2.5 disabled:opacity-40"
            >
              {pending_
                ? "Sending…"
                : blocked
                  ? "Blocked — Fix The File First"
                  : !operator
                    ? "Sign In To Confirm"
                    : !attested
                      ? "Verify The Holder First"
                      : needsAck && !ticketAcked
                        ? "Review The Note First"
                        : needsReason
                          ? "Tag Your Edit First"
                          : route?.openPortal
                            ? "Open Portal & Confirm"
                            : `Send To ${matchedUw?.name.split(" ")[0] ?? "Market"}`}
            </button>
            <button
              type="button"
              onClick={returnForReview}
              disabled={pending_}
              className="btn-ghost"
            >
              Return For Human Review
            </button>
            {!operator && (
              <Link href="/me" className="text-xs text-[var(--coral)] hover:underline">
                Sign In — Your Signature Stamps This Draft
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ————— Context rail ————— */}
      <aside className="space-y-4">
        <div className="glass rounded-2xl p-4">
          <p className="eyebrow">Account</p>
          <p className="mt-1 font-display text-xl text-[var(--ink)]">
            {account.name}
          </p>
          {account.dba && (
            <p className="text-xs text-[var(--muted)]">DBA {account.dba}</p>
          )}
          <p className="mt-1 text-xs text-[var(--muted)]">
            {account.industry} · {account.state}
          </p>
          <div className="mt-3 border-t border-[var(--rule)] pt-3 text-xs text-[var(--muted)]">
            <p>
              Policy{" "}
              <span className="font-medium text-[var(--ink)]">
                {policy.policyNumber}
              </span>
            </p>
            <p className="mt-0.5">{coverageLabels(policy.coverages)}</p>
          </div>
        </div>

        {matchedUw && (
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Underwriter</p>
              <span className="chip">{channelLabel(matchedUw.channelPrimary)}</span>
            </div>
            <p className="mt-1 font-display text-lg text-[var(--ink)]">
              {matchedUw.name}
            </p>
            <p className="text-xs text-[var(--muted)]">{matchedUw.carrier}</p>
            <p className="mt-2 break-all text-xs text-[var(--muted)]">
              {matchedUw.serviceEmail ?? matchedUw.email}
            </p>
          </div>
        )}

        <FormsPanel policies={account.policies} focusPolicyId={policy.id} />

        {ticket.docs.length > 0 && (
          <div className="glass rounded-2xl p-4">
            <p className="eyebrow">On File</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
              Drag into the draft to attach. Customer uploads stay reference-only.
            </p>
            <div className="mt-3 space-y-2">
              {ticket.docs.map((d) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DOC_MIME, d.id);
                    e.dataTransfer.setData("text/plain", d.name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDoubleClick={() => addAccountDoc(d)}
                  className="doc-chip flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-[var(--rule)]"
                  title="Drag into the draft (or double-click)"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--ink)]">
                      {d.name}
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      {docKindLabel(d.kind)} · {d.sizeLabel}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      d.trusted
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {d.trusted ? "Trusted" : "Ref Only"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="glass rounded-2xl p-4">
          <p className="eyebrow">Learning Ledger</p>
          {ledger.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Every confirm and tagged edit lands here — the evidence for raising
              the pace.
            </p>
          ) : (
            <>
              <div className="mt-2 flex gap-4 text-sm">
                <p>
                  <span className="font-semibold text-emerald-700">
                    {ledger.filter((l) => l.outcome === "confirmed" && !l.edited).length}
                  </span>{" "}
                  <span className="text-xs text-[var(--muted)]">Clean</span>
                </p>
                <p>
                  <span className="font-semibold text-[var(--gold)]">
                    {ledger.filter((l) => l.edited).length}
                  </span>{" "}
                  <span className="text-xs text-[var(--muted)]">Edited</span>
                </p>
                <p>
                  <span className="font-semibold text-amber-700">
                    {ledger.filter((l) => l.outcome === "returned").length}
                  </span>{" "}
                  <span className="text-xs text-[var(--muted)]">Returned</span>
                </p>
              </div>
              {(() => {
                const tally = new Map<EditReasonId, number>();
                for (const e of ledger)
                  for (const r of e.reasons) tally.set(r, (tally.get(r) ?? 0) + 1);
                if (tally.size === 0) return null;
                return (
                  <div className="mt-3 space-y-1 border-t border-[var(--rule)] pt-2">
                    {[...tally.entries()].map(([r, n]) => (
                      <p key={r} className="flex justify-between text-xs">
                        <span className="text-[var(--muted)]">
                          {EDIT_REASONS.find((x) => x.id === r)?.label}
                        </span>
                        <span className="font-medium text-[var(--ink)]">{n}</span>
                      </p>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function CheckRow({
  state,
  title,
  detail,
  action,
}: {
  state: "ok" | "warn" | "block" | "todo";
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const dot =
    state === "ok"
      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
      : state === "warn"
        ? "bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
        : state === "block"
          ? "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.15)]"
          : "bg-[var(--muted)]/40 shadow-[0_0_0_4px_rgba(122,135,144,0.12)]";

  return (
    <li className="flex items-start gap-3">
      <span className={`check-dot mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--ink)]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{detail}</p>
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </li>
  );
}
