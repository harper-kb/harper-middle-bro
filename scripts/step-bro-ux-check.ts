import { sampleWorkItemsForLane } from "../src/lib/adapters/bigbrother/sample";
import { sortTicketsOldestFirst } from "../src/lib/all-tickets";
import { outstandingWorkItems } from "../src/lib/desk/types";
import {
  SIGNATURE_REQUIRED_IQ_CARRIERS,
  instantBindBucket,
  sortInstantBindsOldestFirst,
} from "../src/lib/lanes/instant-binds";
import { SERVICE_LANE_IDS, type WorkItem } from "../src/lib/types";

let failed = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

check(
  "Post Sales removed from seven-lane registry",
  SERVICE_LANE_IDS.length === 7 &&
    !(SERVICE_LANE_IDS as readonly string[]).includes("post_sales"),
);

const instantBinds = sampleWorkItemsForLane("instant_binds");
const withoutSignature = instantBinds.filter(
  (item) => instantBindBucket(item) === "no_signature",
);
const withSignature = instantBinds.filter(
  (item) => instantBindBucket(item) === "signature_needed",
);
check("Instant Binds sample has many accounts", instantBinds.length >= 8);
check(
  "Both Instant Binds buckets have multiple accounts",
  withoutSignature.length >= 2 && withSignature.length >= 2,
);
check(
  "Signature carrier config is locked",
  SIGNATURE_REQUIRED_IQ_CARRIERS.join(",") ===
    "rt_connector,blitz,pathpoint,thimble,isc_wc",
);
check(
  "Signature aliases bucket correctly",
  ["RT Connector", "Blitz", "Path Point", "Thimble", "Insurance Services Center WC"].every(
    (carrier) =>
      instantBindBucket({ ...instantBinds[0]!, title: `${carrier} IQ Bind` }) ===
      "signature_needed",
  ),
);
check(
  "Other IQ carriers do not require signature",
  instantBindBucket({ ...instantBinds[0]!, title: "Coterie IQ Bind" }) ===
    "no_signature",
);

function isOldestFirst(items: WorkItem[]): boolean {
  return items.every(
    (item, index) =>
      index === 0 ||
      Date.parse(items[index - 1]!.createdAt) <= Date.parse(item.createdAt),
  );
}
check(
  "Instant Binds sort oldest first",
  isOldestFirst(sortInstantBindsOldestFirst([...instantBinds].reverse())),
);
check(
  "All Tickets sort oldest first",
  isOldestFirst(sortTicketsOldestFirst([...instantBinds].reverse())),
);

const parked = { ...instantBinds[0]!, parkedUntil: "2026-08-12T00:00:00.000Z" };
check(
  "Desk outstanding excludes parked and completed",
  outstandingWorkItems([parked, instantBinds[1]!, instantBinds[2]!], [
    instantBinds[1]!.id,
  ]).map((item) => item.id).join(",") === instantBinds[2]!.id,
);

if (failed) process.exit(1);
console.log("\nAll Step Bro UX checks passed.");

