/**
 * Publish one period's Service Scorecard in shadow mode.
 *
 * This is the step the plan puts before anything else: publish the numbers,
 * let both sides argue with them, fix what breaks, and only then attach
 * compensation. Running it freezes the current board against the period so a
 * dispute three weeks from now argues with the figures people actually saw.
 *
 * Run:
 *   npx tsx --conditions react-server scripts/shadow-period-report.ts          # print only
 *   npx tsx --conditions react-server scripts/shadow-period-report.ts --publish
 *   npx tsx --conditions react-server scripts/shadow-period-report.ts --reconcile
 */
import {
  listScorecardDisputes,
  publishScorecardPeriod,
  reconcileScorecardPeriod,
  saveScorecardPeriod,
} from "../src/lib/db";
import { PERIOD_STATE_LABELS, payoutFor } from "../src/lib/retention/period";
import { loadScorecard } from "../src/lib/retention/scorecard.server";
import {
  formatCents,
  formatMetric,
  SOURCE_LABELS,
} from "../src/lib/retention/scorecard";

const publish = process.argv.includes("--publish");
const reconcile = process.argv.includes("--reconcile");

function rule(char = "—", width = 92) {
  console.log(char.repeat(width));
}

async function main() {
  const view = await loadScorecard();
  const { period } = view;

  console.log(`\nService Scorecard · ${period.label} · ${PERIOD_STATE_LABELS[period.state]}`);
  console.log(`Ledger: ${view.ledgerNote}`);
  console.log(`Packs:  ${view.packNote}`);
  if (period.state === "shadow") {
    console.log(
      "\nNothing in this report pays anyone. It exists to be argued with.",
    );
  }

  rule();
  console.log("PODS");
  rule();
  for (const pod of view.pods) {
    const modeled = payoutFor(period, pod.podId);
    console.log(
      `\n${pod.label} — paid on ${pod.verbLabel}` +
        ` · pool ${formatCents(modeled.modeledCents)} modeled, ${formatCents(modeled.payableCents)} payable`,
    );
    console.log(
      `  ${pod.saves} save(s) of ${pod.atRiskWindows} at-risk window(s)` +
        (pod.uncreditedSaves > 0
          ? ` · ${pod.uncreditedSaves} saved with nothing decisive on the record`
          : ""),
    );
    for (const m of pod.metrics) {
      const note = m.note ? `  (${m.note})` : "";
      console.log(
        `    ${m.label.padEnd(30)} ${formatMetric(m).padStart(10)}  [${SOURCE_LABELS[m.source]}]${note}`,
      );
    }
  }

  rule();
  console.log("PEOPLE");
  rule();
  if (view.people.length === 0) {
    console.log("  No individual attribution this period.");
  }
  for (const person of view.people) {
    console.log(
      `\n${person.displayName} · ${person.podLabel ?? "no pod"} · ${formatCents(person.retainedCommissionCents)}`,
    );
    console.log(
      `  ${person.savesContributed} save(s) touched · ${person.ownedAccounts} account(s) owned · ` +
        `${person.decisiveActions} decisive action(s)` +
        (person.ownerFloorOnly > 0
          ? ` · ${person.ownerFloorOnly} credited on the owner floor alone`
          : ""),
    );
    for (const m of person.metrics) {
      console.log(
        `    ${m.label.padEnd(30)} ${formatMetric(m).padStart(10)}  [${SOURCE_LABELS[m.source]}]`,
      );
    }
  }

  const gated = view.projection.skipped.filter((s) => s.reason !== "not_saved");
  if (gated.length > 0) {
    rule();
    console.log("UNCREDITED AND GATED");
    rule();
    for (const s of gated) {
      console.log(`  ${s.accountId.padEnd(22)} ${s.reason.padEnd(22)} ${s.detail}`);
    }
  }

  if (publish) {
    saveScorecardPeriod(period);
    const stamped = publishScorecardPeriod(period, {
      pods: view.pods,
      people: view.people,
    });
    rule();
    console.log(
      `Published ${stamped.id} at ${stamped.publishedAt}. The board above is now frozen against this period.`,
    );
    console.log("Raise disputes against it; pay stays detached until every one is settled.");
  }

  if (reconcile) {
    const result = reconcileScorecardPeriod(period.id);
    rule();
    console.log("RECONCILIATION");
    rule();
    const disputes = listScorecardDisputes(period.id);
    console.log(
      `  ${disputes.length} dispute(s) · ${result.unsettled.length} still open · ` +
        `${result.readiness.disputesUpheld} upheld · ${result.readiness.correctionsApplied} correction(s) applied`,
    );
    for (const d of disputes) {
      console.log(
        `    [${d.state}] ${d.subject}:${d.subjectId} — ${d.claim}` +
          (d.resolutionNote ? `\n            → ${d.resolutionNote}` : ""),
      );
    }
    if (result.readiness.ready) {
      console.log("\n  Ready to attach pay.");
    } else {
      console.log("\n  Pay stays detached:");
      for (const b of result.readiness.blockers) console.log(`    - ${b}`);
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
