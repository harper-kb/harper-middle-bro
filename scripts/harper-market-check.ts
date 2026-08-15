/**
 * A market is who the desk works. The insurer is who wrote the policy.
 * Confusing the two either strands an account on a desk nobody can reach,
 * or prints an MGA on a certificate as though it carried the risk.
 */

import { resolveMarket, unmatchedMarket } from "../src/lib/adapters/harper/market";
import { naicForPolicy } from "../src/lib/naic";

let failed = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
}

/* ————— MGA: two signals, or nothing ————— */

const coterie = resolveMarket("CSG-00531681-00", "Spinnaker Insurance Company");
check(coterie?.brand === "Coterie", "A CSG number on Spinnaker paper is Coterie");
check(
  coterie?.issuingCarrier === "Spinnaker Insurance Company",
  "…and the writer is kept, so the certificate still names the insurer",
);
check(
  resolveMarket("CEG-1", "Everspan Insurance Company")?.brand === "Coterie" &&
    resolveMarket("CBG-1", "Benchmark Insurance Company")?.brand === "Coterie",
  "Coterie is recognised on each of its fronting carriers",
);

// A three-letter prefix is easy to collide with. Without the paper agreeing,
// relabelling the policy would put the wrong market on the account and the
// wrong company on the paper trail.
check(
  resolveMarket("CSG-00531681-00", "Acme Mutual Insurance Company") === null,
  "A Coterie-shaped number on unrelated paper resolves to nothing",
);
check(
  unmatchedMarket("CSG-00531681-00", "Acme Mutual Insurance Company")?.brand === "Coterie",
  "…and is reported, because it is either a new front or not Coterie at all",
);
check(
  resolveMarket("XYZ-1", "Spinnaker Insurance Company") === null,
  "Spinnaker paper alone is not Coterie — Spinnaker fronts for many programs",
);
check(
  resolveMarket("HSIC-ISC01CM-0000917", "Hadron Specialty Insurance Company")?.brand === "ISC",
  "An HSIC number on Hadron paper is ISC",
);

/* ————— Direct: the brand is the insurer ————— */

const hiscox = resolveMarket("P107.083.126.1", "Hiscox Insurance Company Inc.");
check(hiscox?.brand === "Hiscox", "A direct carrier is recognised from its name alone");
check(
  hiscox?.issuingCarrier === null,
  "…and records no writer, so the brand's verified NAIC rule still applies",
  String(hiscox?.issuingCarrier),
);
check(
  naicForPolicy("Hiscox", ["GL"], hiscox?.issuingCarrier)?.naic === "10200",
  "A direct carrier keeps its verified NAIC code",
);

/* ————— The INSURER line names the company that wrote it ————— */

const onSpinnaker = naicForPolicy("Coterie", ["GL"], "Spinnaker Insurance Company");
check(
  onSpinnaker?.issuingCompany === "Spinnaker Insurance Company" && onSpinnaker?.naic === "24376",
  "A Coterie policy prints Spinnaker, never Coterie",
);
const onEverspan = naicForPolicy("Coterie", ["GL"], "Everspan Insurance Company");
check(
  onEverspan?.issuingCompany === "Everspan Insurance Company",
  "A Coterie policy on Everspan prints Everspan",
  onEverspan?.issuingCompany,
);
// The regression that made this rule necessary: an unverified writer used to
// fall through to the brand's default paper, so an Everspan policy printed
// Spinnaker — a different company, on a document that certifies coverage.
check(
  onEverspan?.naic === null,
  "…with a blank code, rather than borrowing another company's",
  String(onEverspan?.naic),
);
check(
  naicForPolicy("Coterie", ["GL"], null)?.issuingCompany === "Spinnaker Insurance Company",
  "With no writer on the record the brand's default paper still resolves",
);

console.log(failed === 0 ? "\nAll market checks passed." : `\n${failed} FAILURE(S).`);
if (failed > 0) process.exit(1);
