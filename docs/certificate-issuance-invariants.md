# Certificate Issuance Invariants

A wrong certificate is an Errors & Omissions event. This document states the
invariants the certificate system enforces, where each one lives in code, and
how the desk manager's design critique is answered point by point.

## The Invariants

1. **One renderer, two output modes.** There is a single certificate render
   engine (`AcordSheet` in `CertificateStudio.tsx`, fed by
   `buildCertificatePacket` + `resolveCertSheet`). Every non-issued rendering
   — studio preview, batch-run preview, printed or PDF-saved specimen —
   carries a diagonal "Specimen — Not Issued" watermark baked inside
   `.cert-sheet` itself (`.cert-watermark` in `globals.css`, forced on in
   print media). A screenshot, download, or forward of a preview cannot pass
   as issued paper. The clean render exists only while the on-screen inputs
   match, byte for byte, an issuance recorded on the ledger.

2. **One send path.** Every certificate that leaves the system goes through
   `performCertIssuance` (`cert-issuance-core.ts`). The studio's Issue step,
   the batch run's per-holder advance, and the ticket verifier's issue
   decision are thin adapters (`cert-issue.ts`) that resolve inputs and call
   the same function. Nothing else writes a row into `cert_issued`, and no
   decision is recorded as "issued" without one. Path-specific logic may only
   append checks (`appendChecks`); the canonical registry always runs in
   full, so no route can be wider than another.

3. **Canonical check registry.** `cert-checks.ts` holds the named,
   enumerable presend checks — each with a stable id, Title Case name,
   description, severity, and an explicit `overridable` flag. Adding a check
   is adding a registry entry. Every attempt persists its full per-check
   results (`cert_issue_attempts`): which check blocked, when, on whose
   action. Overrides are attributed rows (`cert_check_overrides`: operator +
   written reason + timestamp + check id), applied only to structurally
   overridable checks. Red alert, in-force, verifier rejects, endorsement
   backing, prior-cert sourcing, and snapshot currency fail closed for
   everyone.

4. **Frozen fact snapshot.** Issuance binds to an explicit snapshot
   (`cert-snapshot.ts`): timestamp, per-field provenance (which form,
   schedule row, or registry entry supplied each value), the exact
   Description Of Operations text, and a SHA-256 content digest. The snapshot
   persists with the issued certificate (`cert_issued.snapshot_json`). The
   digest is the staleness clock: a prepared artifact whose digest no longer
   matches a freshly assembled snapshot — or whose TTL (72 hours) has passed
   — is invalidated at send and the certificate regenerates from current
   facts. Upstream mutations (red alert raised, placement rule changed,
   schedule of record replaced) invalidate pending prepared artifacts at the
   mutation site as well.

5. **Source rank and age.** Trust order for coverage facts: policy >
   binder > quote (`SOURCE_TRUST_ORDER`). A prior certificate is never a
   source — a schedule fact tracing to a `coi` document blocks issuance with
   no override. Quote-grade sourcing and source documents older than 400
   days require an attributed override. Endorsement verification is
   per-endorsement, per-form, with the edition date part of form identity:
   an Additional Insured or Waiver Of Subrogation claim without a fully
   identified form (number and edition) blocks, and a scheduled (non-blanket)
   Additional Insured claim requires the holder's registry entry to be
   `bound` — Bind Requested is not bound.

6. **Cancellation re-evaluation and the supersede chain.** Red-alert and
   in-force checks run inside the issuance call, at the send moment, not at
   preparation. Post-issuance error discovery has an explicit path:
   `markCertErroneous` revokes the certificate on record (operator + reason +
   timestamp), generates a holder revocation notice, and the next issuance
   for the same requirement links itself to the revoked paper
   (`supersedes` / `superseded_by`) with a corrected-certificate notice. The
   whole chain is visible in the Certificate Ledger panel on the account
   page.

7. **Holder constraints.** One active certificate per (holder, requirement):
   issuing a new one supersedes the prior active row inside the same
   transaction. The requirement key is the originating ticket when one
   exists, else the normalized holder name. When the certificate rides on a
   service request, the Holder Matches Requirement Source check compares the
   holder against the party the request names; a mismatch needs an
   attributed override.

8. **Learning boundary.** The correction system learns exactly two classes
   (`cert-corrections.ts`): routing (placement rules — where a policy's row
   lands on the printed form) and formatting (saved holder name/address
   rows). `assertLearnableCorrection` gates every learned-behavior write;
   coverage, limits, endorsement selection, and Description Of Operations
   are listed as forbidden kinds and have no persistence path. A placement
   rule moves a section; the values inside always re-resolve off the
   schedule of record, so learned behavior cannot pre-fill a coverage fact.
   Every rule is a versioned row with operator provenance, visible in the
   studio, and revocable.

## Answers To The Critique

| Critique | Enforcement |
| --- | --- |
| Local PDF preview is a second artifact path | Preview and issuance share one renderer; non-issued renders carry the specimen watermark inside the artifact, on screen and on paper. |
| Two send paths make the strict path advisory | All three routes call `performCertIssuance`; the registry cannot be skipped, only extended. |
| Generate-and-attach binds decision and artifact to different moments | The issuance call assembles the snapshot, runs the checks, and records the certificate in one transaction at one timestamp. |
| "Wider" is not "stricter" | Structural: `appendChecks` is additive by construction; there is no parameter that removes a registry entry. |
| "Endorsements verified" against what? | Per-endorsement, per-form, edition date included; scheduled AI claims require `bound` status — Bind Requested blocks. |
| Source document rank and age | Policy > binder > quote; prior cert is non-overridable; 400-day age limit with attributed override. |
| Cancellation as point-in-time | Red alert and in-force re-evaluate inside every issuance call; a red alert also invalidates prepared artifacts when raised. |
| No override policy | Overrides are attributed rows (operator, reason, timestamp, check id); non-overridable checks exist; there is no second path. |
| "Eight presend lines" as a count | The registry is named and enumerable; blocked attempts persist the blocking check ids. |
| Pre-generated certs as stale blessed artifacts | Prepared artifacts carry a TTL, are invalidated on upstream change, and force regeneration at send via the digest comparison. |
| Learning upstream of a rubber stamp | Learning is fenced to routing/formatting; the write gate throws on anything else; rules are versioned, attributed, and revocable. |
| No supersede/revoke chain | `cert_issued` status transitions with linked ids, holder notices for revocation and correction, all rendered in the ledger panel. |
| Fact assembly as a live view | `FactSnapshot` with timestamp, per-field provenance, and content digest, persisted with the certificate. |
| Holder side unconstrained | One active cert per (holder, requirement) enforced transactionally; holder identity checked against the requirement source. |

## Verification

`scripts/cert-invariants-check.ts` (run with `npx tsx`) drives the issuance
core against an in-memory database and asserts: the specimen watermark on
non-issued renders, the single-send-path structure, a registry block with a
logged and attributed override, snapshot staleness invalidation with forced
regeneration, and the supersede/revoke chain with holder notices. The
existing harness checks (`cert-run-check.ts`, `cert-verify-check.ts`,
`cert-corrections-check.ts`, `coi-stress.ts`) continue to cover the sheet
resolvers and verifiers underneath.
